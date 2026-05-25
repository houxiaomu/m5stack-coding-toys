# 主机触发截屏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `m5ct screenshot` command that captures the device's current screen as a PNG and saves it under `~/.m5stack-coding-toys/`, reusing the running daemon (never restarting it or touching the serial port from the CLI).

**Architecture:** CLI sends a new `{op:"screenshot"}` over the existing UNIX control socket → daemon issues a `screenshot` RPC frame to the device via the existing `DeviceSession.request()` → device captures its off-screen M5GFX sprite with `createPng()`, base64-encodes it, and returns one `screenshot.ack` frame → daemon base64-decodes and writes the PNG file. Single-frame transfer (no chunking).

**Tech Stack:** TypeScript (pnpm workspace, vitest, biome), C++17 firmware (PlatformIO, Unity native tests, M5GFX/ArduinoJson), Zod schemas, NDJSON-over-serial protocol.

**Spec:** `docs/superpowers/specs/2026-05-26-m5ct-screenshot-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `packages/protocol/src/kinds.ts` | add `screenshot` / `screenshot.ack` kinds | Modify |
| `packages/protocol/src/messages-host.ts` | `screenshotPayload` | Modify |
| `packages/protocol/src/messages-device.ts` | `screenshotAckPayload` | Modify |
| `packages/protocol/src/registry.ts` | register both schemas | Modify |
| `packages/protocol/src/screenshot.test.ts` | round-trip tests | Create |
| `firmware/lib/m5proto/messages.h` | regenerated kind constants | Generated |
| `firmware/lib/m5proto/base64.h` | `base64Encode` | Create |
| `firmware/lib/m5proto/codec.h` | `encode_screenshot_ack` | Modify |
| `firmware/test/test_screenshot/test_main.cpp` | base64 + ack encode tests | Create |
| `firmware/lib/m5render/canvas.h` | `Canvas::capturePng` virtual | Modify |
| `firmware/lib/mock_hal/mock_canvas.h` | MockCanvas `capturePng` override | Modify |
| `firmware/boards/cores3_se/canvas_m5gfx.{h,cpp}` | CoreS3 `capturePng` impl | Modify |
| `firmware/lib/m5render/app.cpp` | `screenshot` dispatch branch | Modify |
| `firmware/test/test_app/test_main.cpp` | screenshot dispatch test | Modify |
| `tools/fake-firmware/src/main.ts` | emulator `screenshot` reply | Modify |
| `tools/fake-firmware/src/main.test.ts` | emulator reply test | Modify |
| `packages/daemon/src/state-dir.ts` | `screenshotsDir` + `screenshotFilename` | Modify |
| `packages/daemon/src/state-dir.test.ts` | path/filename tests | Modify |
| `packages/daemon/src/control-ops.ts` | `screenshot` control op | Modify |
| `packages/daemon/src/control-ops.test.ts` | screenshot op tests | Modify |
| `packages/daemon/src/hook-server.ts` | `screenshot` op dispatch | Modify |
| `packages/cli/src/cmd-screenshot.ts` | `runScreenshot` | Create |
| `packages/cli/src/cmd-screenshot.test.ts` | CLI tests | Create |
| `packages/cli/src/main.ts` | register `screenshot` command | Modify |

---

## Task 1: Protocol — screenshot kinds & schemas

**Files:**
- Modify: `packages/protocol/src/kinds.ts`
- Modify: `packages/protocol/src/messages-host.ts`
- Modify: `packages/protocol/src/messages-device.ts`
- Modify: `packages/protocol/src/registry.ts`
- Create: `packages/protocol/src/screenshot.test.ts`
- Generated: `firmware/lib/m5proto/messages.h`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/src/screenshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decode, encode } from './codec.js'

describe('screenshot protocol frames', () => {
  it('round-trips a screenshot request (host→device)', () => {
    const wire = encode({ k: 'screenshot', id: 'm1', p: { fmt: 'png' } })
    const env = decode(wire)
    expect(env.k).toBe('screenshot')
    expect(env.id).toBe('m1')
    expect((env.p as { fmt: string }).fmt).toBe('png')
  })

  it('round-trips a screenshot.ack with png payload (device→host)', () => {
    const wire = encode({
      k: 'screenshot.ack',
      id: 'm1',
      p: { ok: true, w: 320, h: 240, fmt: 'png', png_b64: 'iVBORw==' },
    })
    const env = decode(wire)
    expect(env.k).toBe('screenshot.ack')
    const p = env.p as { ok: boolean; w?: number; png_b64?: string }
    expect(p.ok).toBe(true)
    expect(p.w).toBe(320)
    expect(p.png_b64).toBe('iVBORw==')
  })

  it('round-trips a screenshot.ack error', () => {
    const wire = encode({ k: 'screenshot.ack', id: 'm1', p: { ok: false, err: 'capture_unsupported' } })
    const env = decode(wire)
    const p = env.p as { ok: boolean; err?: string }
    expect(p.ok).toBe(false)
    expect(p.err).toBe('capture_unsupported')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol/src/screenshot.test.ts`
Expected: FAIL — `encode` throws `CodecError: invalid payload` / `unknown kind: screenshot` (kinds not registered yet).

- [ ] **Step 3: Add the kinds**

In `packages/protocol/src/kinds.ts`, extend the two arrays:

```ts
export const HOST_KINDS = ['hello', 'status', 'notify', 'ping', 'screenshot'] as const

export const DEVICE_KINDS = ['hello.ack', 'notify.ack', 'device.event', 'pong', 'screenshot.ack'] as const
```

- [ ] **Step 4: Add the host payload**

Append to `packages/protocol/src/messages-host.ts` (before the `export type` block):

```ts
export const screenshotPayload = z.object({
  fmt: z.literal('png').default('png'),
})
```

And add to the type exports at the bottom:

```ts
export type ScreenshotPayload = z.infer<typeof screenshotPayload>
```

- [ ] **Step 5: Add the device payload**

Append to `packages/protocol/src/messages-device.ts` (before the `export type` block):

```ts
export const screenshotAckPayload = z.object({
  ok: z.boolean(),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  fmt: z.literal('png').optional(),
  png_b64: z.string().optional(),
  err: z.string().optional(),
})
```

And to the bottom type exports:

```ts
export type ScreenshotAckPayload = z.infer<typeof screenshotAckPayload>
```

- [ ] **Step 6: Register both schemas**

In `packages/protocol/src/registry.ts`, add to the imports and the `PAYLOAD_SCHEMAS` object:

```ts
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
  screenshotAckPayload,
} from './messages-device.js'
import {
  helloPayload,
  notifyPayload,
  pingPayload,
  screenshotPayload,
  statusPayload,
} from './messages-host.js'

export const PAYLOAD_SCHEMAS = {
  hello: helloPayload,
  status: statusPayload,
  notify: notifyPayload,
  ping: pingPayload,
  screenshot: screenshotPayload,
  'hello.ack': helloAckPayload,
  'notify.ack': notifyAckPayload,
  'device.event': deviceEventPayload,
  pong: pongPayload,
  'screenshot.ack': screenshotAckPayload,
} as const satisfies Record<Kind, z.ZodTypeAny>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run packages/protocol/src/screenshot.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Regenerate firmware message constants**

Run: `pnpm gen:msgs`
Expected: `[gen-msgs] wrote …/firmware/lib/m5proto/messages.h`. Confirm `firmware/lib/m5proto/messages.h` now contains `constexpr const char* screenshot = "screenshot";` and `constexpr const char* screenshot_ack = "screenshot.ack";`.

Then verify it is in sync: `pnpm gen:msgs:check` → `is up to date`.

- [ ] **Step 9: Build protocol so downstream packages see new types**

Run: `pnpm --filter @m5stack-coding-toys/protocol build`
Expected: no errors (emits `packages/protocol/dist`).

- [ ] **Step 10: Lint & commit**

```bash
pnpm lint:fix
git add packages/protocol/src/kinds.ts packages/protocol/src/messages-host.ts packages/protocol/src/messages-device.ts packages/protocol/src/registry.ts packages/protocol/src/screenshot.test.ts firmware/lib/m5proto/messages.h
git commit -m "feat(protocol): add screenshot and screenshot.ack frames

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Firmware — base64 encoder (native test)

**Files:**
- Create: `firmware/lib/m5proto/base64.h`
- Create: `firmware/test/test_screenshot/test_main.cpp`

- [ ] **Step 1: Write the failing test**

Create `firmware/test/test_screenshot/test_main.cpp`:

```cpp
#include <unity.h>
#include <cstdint>
#include <string>

#include "base64.h"

using m5proto::base64Encode;

static std::string b64(const std::string& s) {
  return base64Encode(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

void setUp() {}
void tearDown() {}

void test_base64_empty() { TEST_ASSERT_EQUAL_STRING("", b64("").c_str()); }
void test_base64_pad2()  { TEST_ASSERT_EQUAL_STRING("TQ==", b64("M").c_str()); }
void test_base64_pad1()  { TEST_ASSERT_EQUAL_STRING("TWE=", b64("Ma").c_str()); }
void test_base64_nopad() { TEST_ASSERT_EQUAL_STRING("TWFu", b64("Man").c_str()); }

void test_base64_png_magic() {
  const uint8_t bytes[] = {0x89, 'P', 'N', 'G'};
  TEST_ASSERT_EQUAL_STRING("iVBORw==", base64Encode(bytes, 4).c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_base64_empty);
  RUN_TEST(test_base64_pad2);
  RUN_TEST(test_base64_pad1);
  RUN_TEST(test_base64_nopad);
  RUN_TEST(test_base64_png_magic);
  return UNITY_END();
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test -- -f test_screenshot` (or `pio test --project-dir firmware -e native -f test_screenshot`)
Expected: FAIL to compile — `base64.h: No such file or directory`.

- [ ] **Step 3: Implement base64**

Create `firmware/lib/m5proto/base64.h`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace m5proto {

// Standard base64 (RFC 4648) with '=' padding. Output is JSON-safe (no chars
// needing escaping), so callers can embed it directly in a JSON string.
inline std::string base64Encode(const uint8_t* data, std::size_t n) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((n + 2) / 3) * 4);
  std::size_t i = 0;
  for (; i + 3 <= n; i += 3) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8) | data[i + 2];
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += T[(v >> 6) & 0x3F];
    out += T[v & 0x3F];
  }
  const std::size_t rem = n - i;
  if (rem == 1) {
    const uint32_t v = uint32_t(data[i]) << 16;
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += "==";
  } else if (rem == 2) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8);
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += T[(v >> 6) & 0x3F];
    out += '=';
  }
  return out;
}

}  // namespace m5proto
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm fw:test -- -f test_screenshot`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/m5proto/base64.h firmware/test/test_screenshot/test_main.cpp
git commit -m "feat(firmware): add base64 encoder for screenshot payloads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Firmware — encode_screenshot_ack (native test)

**Files:**
- Modify: `firmware/lib/m5proto/codec.h`
- Modify: `firmware/test/test_screenshot/test_main.cpp`

Depends on Task 1 (regenerated `messages.h` provides `kind::screenshot_ack`).

- [ ] **Step 1: Add failing tests**

In `firmware/test/test_screenshot/test_main.cpp`, add the include and two tests, and register them in `main`:

```cpp
#include <cstring>
#include "codec.h"   // add near the top

void test_ack_ok_decodes() {
  std::string line = m5proto::encode_screenshot_ack("m1", 0, true, 320, 240, "iVBORw==", nullptr);
  m5proto::DecodedEnvelope env;
  TEST_ASSERT_EQUAL(static_cast<int>(m5proto::DecodeResult::Ok),
                    static_cast<int>(m5proto::decode(line.c_str(), line.size(), env)));
  TEST_ASSERT_EQUAL_STRING("screenshot.ack", env.kind);
  TEST_ASSERT_EQUAL_STRING("m1", env.id);
  TEST_ASSERT_TRUE(env.doc["p"]["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("iVBORw==", env.doc["p"]["png_b64"].as<const char*>());
  TEST_ASSERT_EQUAL(320, env.doc["p"]["w"].as<int>());
}

void test_ack_err_decodes() {
  std::string line = m5proto::encode_screenshot_ack(nullptr, 0, false, 0, 0, "", "capture_unsupported");
  m5proto::DecodedEnvelope env;
  TEST_ASSERT_EQUAL(static_cast<int>(m5proto::DecodeResult::Ok),
                    static_cast<int>(m5proto::decode(line.c_str(), line.size(), env)));
  TEST_ASSERT_FALSE(env.doc["p"]["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("capture_unsupported", env.doc["p"]["err"].as<const char*>());
}
```

Add to `main`:
```cpp
  RUN_TEST(test_ack_ok_decodes);
  RUN_TEST(test_ack_err_decodes);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test -- -f test_screenshot`
Expected: FAIL to compile — `encode_screenshot_ack` not declared.

- [ ] **Step 3: Implement encode_screenshot_ack**

In `firmware/lib/m5proto/codec.h`, add `#include <string>` to the includes and append this function inside `namespace m5proto` (after `encode_hello_ack`):

```cpp
// Build a screenshot.ack line by string concatenation. base64 uses only
// [A-Za-z0-9+/=] and `err` is a controlled constant — neither needs JSON
// escaping — so we avoid ArduinoJson's copies of a multi-KB payload.
inline std::string encode_screenshot_ack(
    const char* id, uint64_t t, bool ok,
    int w, int h, const std::string& png_b64, const char* err) {
  std::string s = "{\"v\":1";
  if (id && id[0]) { s += ",\"id\":\""; s += id; s += "\""; }
  s += ",\"k\":\""; s += kind::screenshot_ack; s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"ok\":";
  s += ok ? "true" : "false";
  if (ok) {
    s += ",\"w\":"; s += std::to_string(w);
    s += ",\"h\":"; s += std::to_string(h);
    s += ",\"fmt\":\"png\",\"png_b64\":\""; s += png_b64; s += "\"";
  } else if (err && err[0]) {
    s += ",\"err\":\""; s += err; s += "\"";
  }
  s += "}}";
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm fw:test -- -f test_screenshot`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/m5proto/codec.h firmware/test/test_screenshot/test_main.cpp
git commit -m "feat(firmware): encode screenshot.ack frames

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Firmware — Canvas::capturePng (interface + Mock + CoreS3)

**Files:**
- Modify: `firmware/lib/m5render/canvas.h`
- Modify: `firmware/lib/mock_hal/mock_canvas.h`
- Modify: `firmware/boards/cores3_se/canvas_m5gfx.h`
- Modify: `firmware/boards/cores3_se/canvas_m5gfx.cpp`

This task adds the capture seam; it is exercised by the test in Task 5. CoreS3 impl is verified by a device-env compile.

- [ ] **Step 1: Add the virtual to the Canvas interface**

In `firmware/lib/m5render/canvas.h`, add `#include <vector>` near the top includes, and add this method to the `Canvas` class (after `measureText`):

```cpp
  // Capture the current frame as PNG bytes into `out`. Returns false if the
  // device/canvas cannot produce a screenshot. Default: unsupported.
  virtual bool capturePng(std::vector<uint8_t>& out) {
    (void)out;
    return false;
  }
```

- [ ] **Step 2: Override in MockCanvas**

In `firmware/lib/mock_hal/mock_canvas.h`, add inside `class MockCanvas` (after the `measureText` override):

```cpp
  // Canned 4-byte capture so test_app can assert the screenshot path without
  // a real framebuffer. base64("\x89PNG") == "iVBORw==".
  bool capturePng(std::vector<uint8_t>& out) override {
    calls.push_back("capturePng");
    out = {0x89, 'P', 'N', 'G'};
    return true;
  }
```

- [ ] **Step 3: Declare the CoreS3 override**

In `firmware/boards/cores3_se/canvas_m5gfx.h`, add `#include <vector>` near the top, and declare inside `class CoreS3Canvas` (after `int measureText(...) override;`):

```cpp
    bool capturePng(std::vector<uint8_t>& out) override;
```

- [ ] **Step 4: Implement the CoreS3 override**

In `firmware/boards/cores3_se/canvas_m5gfx.cpp`, add the implementation (anywhere inside `namespace m5render`, e.g. after `end()`):

```cpp
bool CoreS3Canvas::capturePng(std::vector<uint8_t>& out) {
    if (!ready_) return false;
    std::size_t len = 0;
    void* png = sprite_.createPng(&len);  // M5GFX encodes the off-screen sprite
    if (!png || len == 0) {
        if (png) free(png);
        return false;
    }
    const uint8_t* p = static_cast<const uint8_t*>(png);
    out.assign(p, p + len);
    free(png);  // createPng returns a malloc'd buffer; caller frees
    return true;
}
```

If `canvas_m5gfx.cpp` does not already include `<vector>` / `<cstdlib>`, add them at the top.

- [ ] **Step 5: Verify native still compiles (interface + mock)**

Run: `pnpm fw:test -- -f test_pages`
Expected: PASS (existing page tests still build/pass with the new virtual present).

- [ ] **Step 6: Verify CoreS3 device build compiles**

Run: `pio run --project-dir firmware -e cores3-se`
Expected: SUCCESS (`canvas_m5gfx.cpp` with `createPng` compiles and links). This pulls the ESP32 toolchain + M5GFX (cached from prior flashes).

- [ ] **Step 7: Commit**

```bash
git add firmware/lib/m5render/canvas.h firmware/lib/mock_hal/mock_canvas.h firmware/boards/cores3_se/canvas_m5gfx.h firmware/boards/cores3_se/canvas_m5gfx.cpp
git commit -m "feat(firmware): add Canvas::capturePng (CoreS3 via createPng)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Firmware — App dispatch for screenshot

**Files:**
- Modify: `firmware/lib/m5render/app.cpp`
- Modify: `firmware/test/test_app/test_main.cpp`

Depends on Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing test**

In `firmware/test/test_app/test_main.cpp`, add this test (and register it in the test's `main()` runner — mirror how existing `RUN_TEST(...)` lines are listed):

```cpp
void test_screenshot_returns_ack_with_png() {
  MockTransport t; MockCanvas c; Board b = makeBoard(t);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"screenshot\",\"t\":0,\"id\":\"m1\",\"p\":{\"fmt\":\"png\"}}";
  app.handleLine(req, std::strlen(req));

  TEST_ASSERT_TRUE(c.called("capturePng", ""));   // MockCanvas recorded "capturePng"
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"screenshot.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"id\":\"m1\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"png_b64\":\"iVBORw==\"") != std::string::npos);
}
```

Note: `MockCanvas::called("capturePng", "")` matches the recorded `"capturePng"` bare entry (the `called` helper compares `"capturePng:"`; if that does not match a bare push, use `c.calledPrefix("capturePng")` instead — `calledPrefix` matches the bare `"capturePng"`).

> Implementer note: use `TEST_ASSERT_TRUE(c.calledPrefix("capturePng"));` — `calledPrefix` matches the bare `"capturePng"` string MockCanvas pushes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test -- -f test_app`
Expected: FAIL — no `screenshot.ack` in TX (App ignores the unknown `screenshot` kind), assertion fails.

- [ ] **Step 3: Implement the dispatch branch**

In `firmware/lib/m5render/app.cpp`:

Add includes near the top (with the existing `<cstring>` etc.):
```cpp
#include <string>
#include <vector>

#include "base64.h"
```

In `App::handleLine`, add this branch after the `ping` branch (before the `status` branch):

```cpp
    if (std::strcmp(env.kind, m5proto::kind::screenshot) == 0) {
        std::vector<uint8_t> png;
        if (canvas_.capturePng(png) && !png.empty()) {
            std::string b64 = m5proto::base64Encode(png.data(), png.size());
            std::string line = m5proto::encode_screenshot_ack(
                env.id, 0, true, canvas_.width(), canvas_.height(), b64, nullptr);
            send(line.c_str(), line.size());
        } else {
            std::string line = m5proto::encode_screenshot_ack(
                env.id, 0, false, 0, 0, std::string(), "capture_unsupported");
            send(line.c_str(), line.size());
        }
        return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm fw:test -- -f test_app`
Expected: PASS (existing app tests + the new one).

- [ ] **Step 5: Run the full native suite**

Run: `pnpm fw:test`
Expected: all native suites PASS (test_app, test_screenshot, test_pages, test_native_codec, test_native_ndjson, test_native_smoke, test_status_model).

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/m5render/app.cpp firmware/test/test_app/test_main.cpp
git commit -m "feat(firmware): handle screenshot frame, reply screenshot.ack

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Emulator — fake-firmware screenshot reply

**Files:**
- Modify: `tools/fake-firmware/src/main.ts`
- Modify: `tools/fake-firmware/src/main.test.ts`

Depends on Task 1 (built protocol).

- [ ] **Step 1: Write the failing test**

Inspect `tools/fake-firmware/src/main.test.ts` for the existing `handle`-style test pattern (how it feeds a frame and captures `send` output). Add a test that feeds a `screenshot` request and asserts a `screenshot.ack` with `ok:true` and a `png_b64` is emitted, echoing the id. Example (adapt to the file's existing harness for capturing stdout):

```ts
it('replies screenshot.ack to a screenshot request', () => {
  const out = captureSend(() => handle('cores3-se', encode({ k: 'screenshot', id: 'm1', p: { fmt: 'png' } })))
  const env = decode(out[0])
  expect(env.k).toBe('screenshot.ack')
  expect(env.id).toBe('m1')
  const p = env.p as { ok: boolean; png_b64?: string }
  expect(p.ok).toBe(true)
  expect(typeof p.png_b64).toBe('string')
})
```

> If `handle`/`send` are not exported/captured by the existing tests, mirror exactly the mechanism those tests already use (e.g. spying on `process.stdout.write`). Do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tools/fake-firmware/src/main.test.ts`
Expected: FAIL — emulator logs `ignoring screenshot`, no ack emitted.

- [ ] **Step 3: Implement the emulator branch**

In `tools/fake-firmware/src/main.ts`, in `handle()` add before the final `ignoring` line:

```ts
  if (env.k === 'screenshot') {
    send(
      encode({
        k: 'screenshot.ack',
        ...(env.id ? { id: env.id } : {}),
        p: { ok: true, w: 320, h: 240, fmt: 'png', png_b64: 'iVBORw==' },
      }),
    )
    return
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tools/fake-firmware/src/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/fake-firmware/src/main.ts tools/fake-firmware/src/main.test.ts
git commit -m "feat(fake-firmware): reply to screenshot with a canned png

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Daemon — screenshot control op

**Files:**
- Modify: `packages/daemon/src/state-dir.ts`
- Modify: `packages/daemon/src/state-dir.test.ts`
- Modify: `packages/daemon/src/control-ops.ts`
- Modify: `packages/daemon/src/control-ops.test.ts`
- Modify: `packages/daemon/src/hook-server.ts`

Depends on Task 1 (built protocol).

- [ ] **Step 1: Write failing state-dir tests**

In `packages/daemon/src/state-dir.test.ts`, add (importing the new functions):

```ts
import { screenshotFilename, screenshotsDir } from './state-dir.js'

describe('screenshot paths', () => {
  it('screenshotsDir is under the state dir', () => {
    expect(screenshotsDir('/home/x')).toBe('/home/x/.m5stack-coding-toys/screenshots')
  })
  it('screenshotFilename is filesystem-safe and ends with .png', () => {
    const name = screenshotFilename(new Date('2026-05-26T14:03:05.123Z'))
    expect(name).toBe('2026-05-26T14-03-05.png')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/daemon/src/state-dir.test.ts`
Expected: FAIL — `screenshotsDir`/`screenshotFilename` not exported.

- [ ] **Step 3: Implement state-dir helpers**

Append to `packages/daemon/src/state-dir.ts`:

```ts
export function screenshotsDir(home: string = homedir()): string {
  return resolve(stateDir(home), 'screenshots')
}

// Filesystem-safe UTC timestamp filename, e.g. 2026-05-26T14-03-05.png
export function screenshotFilename(now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 19).replace(/:/g, '-')
  return `${ts}.png`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/daemon/src/state-dir.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing control-ops tests**

In `packages/daemon/src/control-ops.test.ts`, add (adapt imports to the file's existing style):

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeControlHandler } from './control-ops.js'
import type { DeviceManager } from './device-manager.js'

function dmWith(session: unknown): DeviceManager {
  return { currentSession: () => session } as unknown as DeviceManager
}

describe('screenshot control op', () => {
  it('writes the decoded png to the given path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm5shot-'))
    const out = join(dir, 'shot.png')
    const session = {
      request: async () => ({ k: 'screenshot.ack', p: { ok: true, png_b64: 'aGk=' } }),
    }
    const h = makeControlHandler(dmWith(session))
    const r = await h.screenshot(out)
    expect(r).toEqual({ ok: true, path: out })
    expect(readFileSync(out).toString()).toBe('hi') // base64 "aGk=" === "hi"
    rmSync(dir, { recursive: true, force: true })
  })

  it('errors when no device is connected', async () => {
    const h = makeControlHandler(dmWith(null))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'no_device' })
  })

  it('maps a timeout to device_timeout', async () => {
    const session = {
      request: async () => {
        const e = new Error('timed out') as Error & { code?: string }
        e.code = 'ETIMEDOUT'
        throw e
      },
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'device_timeout' })
  })

  it('surfaces a device capture failure', async () => {
    const session = {
      request: async () => ({ k: 'screenshot.ack', p: { ok: false, err: 'capture_unsupported' } }),
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'capture_unsupported' })
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run packages/daemon/src/control-ops.test.ts`
Expected: FAIL — `screenshot` not on `ControlHandler`.

- [ ] **Step 7: Implement the control op**

In `packages/daemon/src/control-ops.ts`:

Add imports at the top:
```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { screenshotFilename, screenshotsDir } from './state-dir.js'
```

Add to the `ControlHandler` interface:
```ts
  screenshot(out?: string): Promise<{ ok: true; path: string } | { error: string }>
```

Add to the object returned by `makeControlHandler`:
```ts
    async screenshot(out?: string) {
      const sess = dm.currentSession()
      if (!sess) return { error: 'no_device' as const } as { error: string }
      let env: Awaited<ReturnType<typeof sess.request>>
      try {
        env = await sess.request({ k: 'screenshot', p: { fmt: 'png' } }, 5000)
      } catch (err) {
        const e = err as Error & { code?: string }
        return { error: e.code === 'ETIMEDOUT' ? 'device_timeout' : e.message }
      }
      const p = env.p as { ok: boolean; png_b64?: string; err?: string }
      if (!p.ok || !p.png_b64) return { error: p.err ?? 'capture_failed' }
      const path = out ?? resolve(screenshotsDir(), screenshotFilename())
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from(p.png_b64, 'base64'))
      return { ok: true as const, path }
    },
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run packages/daemon/src/control-ops.test.ts`
Expected: PASS (4 new tests).

- [ ] **Step 9: Wire the op into the hook server**

In `packages/daemon/src/hook-server.ts`, in `dispatchOp`'s `switch`, add before `default`:

```ts
        case 'screenshot': {
          const out = typeof msg.out === 'string' ? msg.out : undefined
          const r = await this.control.screenshot(out)
          sock.end(`${JSON.stringify(r)}\n`)
          return
        }
```

- [ ] **Step 10: Run daemon tests + build**

Run: `npx vitest run packages/daemon/`
Expected: PASS. Then `pnpm --filter @m5stack-coding-toys/daemon build` → no errors.

- [ ] **Step 11: Lint & commit**

```bash
pnpm lint:fix
git add packages/daemon/src/state-dir.ts packages/daemon/src/state-dir.test.ts packages/daemon/src/control-ops.ts packages/daemon/src/control-ops.test.ts packages/daemon/src/hook-server.ts
git commit -m "feat(daemon): add screenshot control op

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: CLI — m5ct screenshot command

**Files:**
- Create: `packages/cli/src/cmd-screenshot.ts`
- Create: `packages/cli/src/cmd-screenshot.test.ts`
- Modify: `packages/cli/src/main.ts`

Depends on Task 1 (built protocol) and Task 7 (daemon op exists for end-to-end, but CLI unit tests stub the call).

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/cmd-screenshot.test.ts`:

```ts
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runScreenshot } from './cmd-screenshot.js'

function io() {
  const logs: string[] = []
  const errs: string[] = []
  return { logs, errs, io: { log: (l: string) => logs.push(l), error: (l: string) => errs.push(l) } }
}

describe('runScreenshot', () => {
  it('sends a screenshot op and prints the saved path', async () => {
    const call = vi.fn(async () => ({ ok: true, path: '/home/x/.m5stack-coding-toys/screenshots/a.png' }))
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', { op: 'screenshot' })
    expect(t.logs[0]).toContain('Saved: /home/x/.m5stack-coding-toys/screenshots/a.png')
  })

  it('resolves -o to an absolute path before sending', async () => {
    const call = vi.fn(async () => ({ ok: true, path: resolve(process.cwd(), 'shot.png') }))
    const t = io()
    const code = await runScreenshot(['-o', 'shot.png'], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledWith('/tmp/s.sock', { op: 'screenshot', out: resolve(process.cwd(), 'shot.png') })
  })

  it('prints the error and returns 1 on failure', async () => {
    const call = vi.fn(async () => ({ error: 'no_device' }))
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(1)
    expect(t.errs[0]).toContain('no_device')
  })

  it('returns 1 when the daemon is unreachable', async () => {
    const call = vi.fn(async () => {
      throw new Error('daemon socket not found')
    })
    const t = io()
    const code = await runScreenshot([], t.io, { call, socket: '/tmp/s.sock' })
    expect(code).toBe(1)
    expect(t.errs[0]).toContain('daemon socket not found')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/cli/src/cmd-screenshot.test.ts`
Expected: FAIL — `cmd-screenshot.js` does not exist.

- [ ] **Step 3: Implement the command**

Create `packages/cli/src/cmd-screenshot.ts`:

```ts
import { resolve } from 'node:path'
import { callOnce, defaultSocket } from './control-client.js'
import type { CliIO } from './main.js'

interface ShotResult {
  ok?: boolean
  path?: string
  error?: string
}

type ShotCall = (sockPath: string, msg: object) => Promise<ShotResult>

export interface ScreenshotOpts {
  call?: ShotCall
  socket?: string
}

function parseOut(args: readonly string[]): string | undefined {
  const i = args.findIndex((a) => a === '-o' || a === '--out')
  if (i === -1) return undefined
  const v = args[i + 1]
  if (!v) throw new Error('missing path after -o')
  return resolve(process.cwd(), v)
}

export async function runScreenshot(
  args: readonly string[],
  io: CliIO,
  opts: ScreenshotOpts = {},
): Promise<number> {
  const call: ShotCall = opts.call ?? ((s, m) => callOnce<ShotResult>(s, m))
  const sock = opts.socket ?? defaultSocket()
  let out: string | undefined
  try {
    out = parseOut(args)
  } catch (err) {
    io.error(`m5ct screenshot: ${(err as Error).message}`)
    return 1
  }
  try {
    const r = await call(sock, { op: 'screenshot', ...(out ? { out } : {}) })
    if (r.ok && r.path) {
      io.log(`Saved: ${r.path}`)
      return 0
    }
    io.error(`m5ct screenshot: ${r.error ?? 'unknown error'}`)
    return 1
  } catch (err) {
    io.error(`m5ct screenshot: ${(err as Error).message}`)
    return 1
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/cli/src/cmd-screenshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the command in main.ts**

In `packages/cli/src/main.ts`:

Add the import:
```ts
import { runScreenshot } from './cmd-screenshot.js'
```

Add `'screenshot'` to `listCommands()`:
```ts
export function listCommands(): readonly string[] {
  return ['status', 'watch', 'flash', 'install', 'uninstall', 'version', 'screenshot'] as const
}
```

Add the case to the `switch (sub)`:
```ts
    case 'screenshot':
      return runScreenshot(rest, io)
```

- [ ] **Step 6: Run the CLI test suite**

Run: `npx vitest run packages/cli/`
Expected: PASS (including `main.test.ts` — if it asserts the command list, the added `screenshot` entry is covered; update that assertion if present).

- [ ] **Step 7: Lint & commit**

```bash
pnpm lint:fix
git add packages/cli/src/cmd-screenshot.ts packages/cli/src/cmd-screenshot.test.ts packages/cli/src/main.ts
git commit -m "feat(cli): add m5ct screenshot command

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Workspace build**

Run: `pnpm build`
Expected: all packages build with no errors.

- [ ] **Step 2: gen:msgs sync check**

Run: `pnpm gen:msgs:check`
Expected: `is up to date`.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 4: All TS tests**

Run: `pnpm test`
Expected: all suites PASS.

- [ ] **Step 5: All firmware native tests**

Run: `pnpm fw:test`
Expected: all native suites PASS (incl. `test_screenshot`, `test_app`).

- [ ] **Step 6: CoreS3 device build**

Run: `pio run --project-dir firmware -e cores3-se`
Expected: SUCCESS.

- [ ] **Step 7: (Optional, no hardware) Manual end-to-end with the emulator**

If a daemon + fake-firmware harness is convenient (see `packages/daemon/src/e2e.test.ts` for the wiring), confirm `m5ct screenshot -o /tmp/x.png` writes a non-empty file whose bytes equal the emulator's canned base64. Otherwise this is covered by Tasks 6–8 unit/integration tests.

- [ ] **Step 8: Final commit (if any lint/format drift)**

```bash
pnpm lint:fix
git add -A
git commit -m "chore: screenshot feature verification pass

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Hardware Acceptance (requires user, after merge-ready)

Not part of automated execution — run with the user present via the **m5stack-cores3-bring-up** skill:

1. Flash the CoreS3 SE with firmware built from this branch.
2. With a Claude Code session driving the device (Live page), run `m5ct screenshot`.
3. Open the saved PNG under `~/.m5stack-coding-toys/screenshots/`; confirm it matches the screen pixel-for-pixel.
4. Repeat on the Waiting page.
5. Confirm the daemon did not restart and the device session stayed connected throughout (`m5ct status` before/after shows the same session).
6. Note the actual PNG byte size; if it is far larger than ~8KB, open a follow-up to add chunked transfer (spec §3/§9).
