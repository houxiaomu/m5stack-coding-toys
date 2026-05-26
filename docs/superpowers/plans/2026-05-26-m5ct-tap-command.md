# m5ct Tap Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `m5ct tap <x> <y> [--duration <ms>]` so the CLI can simulate a coordinate tap on the connected M5Stack screen through the existing daemon and device protocol.

**Architecture:** Add a protocol-level `tap` RPC with `tap.ack`, then expose it through the daemon control socket and a focused CLI command. Firmware validates the coordinate against the connected display, reuses the existing app-level tap action, and acknowledges success or a device-side error.

**Tech Stack:** TypeScript, Vitest, Zod protocol schemas, Node UNIX sockets, C++ firmware, PlatformIO native tests.

---

## File Map

- Modify `packages/protocol/src/kinds.ts`: add `tap` and `tap.ack` kinds.
- Modify `packages/protocol/src/messages-host.ts`: add `tapPayload` and exported type.
- Modify `packages/protocol/src/messages-device.ts`: add `tapAckPayload` and exported type.
- Modify `packages/protocol/src/registry.ts`: register the new payload schemas.
- Modify `packages/protocol/src/messages-host.test.ts`: cover host tap validation/defaults.
- Modify `packages/protocol/src/messages-device.test.ts`: cover tap ack validation.
- Modify generated `firmware/lib/m5proto/messages.h`: regenerate kind constants with `pnpm gen:msgs`.
- Create `packages/cli/src/cmd-tap.ts`: parse tap args and call daemon.
- Create `packages/cli/src/cmd-tap.test.ts`: unit-test parsing, daemon payloads, and output.
- Modify `packages/cli/src/main.ts`: add `tap` to command list and dispatch.
- Modify `packages/cli/src/main.test.ts`: update command list and usage text.
- Modify `packages/daemon/src/control-ops.ts`: add `ControlHandler.tap()`.
- Modify `packages/daemon/src/hook-server.ts`: dispatch `op:"tap"` and validate socket payload shape.
- Modify `packages/daemon/src/control-ops.test.ts`: test daemon tap success/error paths and socket dispatch.
- Modify `firmware/lib/m5render/app.h`: expose a test-only `page()` accessor and add private `handleTouchTapAction()`.
- Modify `firmware/lib/m5render/app.cpp`: handle host `tap` frames and share physical/simulated tap action.
- Modify `firmware/lib/m5proto/codec.h`: add `encode_tap_ack()`.
- Modify `firmware/test/test_app/test_main.cpp`: cover firmware tap ack, page advance, inactive states, bounds, and unsupported touch.
- Modify `tools/fake-firmware/src/main.ts`: reply to `tap` for integration tests.

## Task 1: Protocol Kinds And Schemas

**Files:**
- Modify: `packages/protocol/src/kinds.ts`
- Modify: `packages/protocol/src/messages-host.ts`
- Modify: `packages/protocol/src/messages-device.ts`
- Modify: `packages/protocol/src/registry.ts`
- Modify: `packages/protocol/src/messages-host.test.ts`
- Modify: `packages/protocol/src/messages-device.test.ts`
- Generated: `firmware/lib/m5proto/messages.h`

- [ ] **Step 1: Write failing host protocol tests**

Add `tapPayload` to the imports in `packages/protocol/src/messages-host.test.ts`:

```ts
import { helloPayload, notifyPayload, pingPayload, statusPayload, tapPayload } from './messages-host.js'
```

Add:

```ts
describe('tapPayload', () => {
  it('accepts coordinates and defaults duration', () => {
    expect(tapPayload.parse({ x: 160, y: 120 })).toEqual({
      x: 160,
      y: 120,
      duration_ms: 50,
    })
  })

  it('accepts an explicit duration', () => {
    expect(tapPayload.parse({ x: 1, y: 2, duration_ms: 120 })).toEqual({
      x: 1,
      y: 2,
      duration_ms: 120,
    })
  })

  it('rejects invalid coordinates and durations', () => {
    expect(tapPayload.safeParse({ x: -1, y: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 1.5, y: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: -1 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: 0, duration_ms: 0 }).success).toBe(false)
    expect(tapPayload.safeParse({ x: 0, y: 0, duration_ms: 5001 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Write failing device protocol tests**

In `packages/protocol/src/messages-device.test.ts`, import `tapAckPayload` and add:

```ts
describe('tapAckPayload', () => {
  it('accepts success and expected failure payloads', () => {
    expect(tapAckPayload.safeParse({ ok: true }).success).toBe(true)
    expect(tapAckPayload.safeParse({ ok: false, err: 'out_of_bounds' }).success).toBe(true)
  })

  it('rejects non-boolean ok', () => {
    expect(tapAckPayload.safeParse({ ok: 'true' }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Run protocol tests to verify failure**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts packages/protocol/src/messages-device.test.ts
```

Expected: fails because `tapPayload` / `tapAckPayload` are not exported.

- [ ] **Step 4: Implement protocol schemas and registry**

Update `packages/protocol/src/kinds.ts`:

```ts
export const HOST_KINDS = ['hello', 'status', 'notify', 'ping', 'screenshot', 'tap'] as const

export const DEVICE_KINDS = [
  'hello.ack',
  'notify.ack',
  'device.event',
  'pong',
  'screenshot.ack',
  'tap.ack',
] as const
```

Add to `packages/protocol/src/messages-host.ts`:

```ts
export const tapPayload = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    duration_ms: z.number().int().min(1).max(5000).default(50),
  })
  .strict()

export type TapPayload = z.infer<typeof tapPayload>
```

Add to `packages/protocol/src/messages-device.ts`:

```ts
export const tapAckPayload = z
  .object({
    ok: z.boolean(),
    err: z.string().optional(),
  })
  .strict()

export type TapAckPayload = z.infer<typeof tapAckPayload>
```

Update `packages/protocol/src/registry.ts` imports and payload map:

```ts
import {
  deviceEventPayload,
  helloAckPayload,
  notifyAckPayload,
  pongPayload,
  screenshotAckPayload,
  tapAckPayload,
} from './messages-device.js'
import {
  helloPayload,
  notifyPayload,
  pingPayload,
  screenshotPayload,
  statusPayload,
  tapPayload,
} from './messages-host.js'
```

Add map entries:

```ts
tap: tapPayload,
'tap.ack': tapAckPayload,
```

Regenerate firmware message constants:

```bash
pnpm gen:msgs
```

- [ ] **Step 5: Run protocol tests to verify pass**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts packages/protocol/src/messages-device.test.ts packages/protocol/src/kinds.test.ts packages/protocol/src/codec.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit protocol changes**

```bash
git add packages/protocol/src firmware/lib/m5proto/messages.h
git commit -m "feat(protocol): add tap rpc"
```

## Task 2: CLI Tap Command

**Files:**
- Create: `packages/cli/src/cmd-tap.ts`
- Create: `packages/cli/src/cmd-tap.test.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/src/main.test.ts`

- [ ] **Step 1: Write failing CLI command tests**

Create `packages/cli/src/cmd-tap.test.ts` with tests for default duration, explicit duration, bad args, daemon errors, and socket exceptions. Use the same injected call pattern as `cmd-screenshot.test.ts`.

Core expected calls:

```ts
await runTap(['160', '120'], io, { call, socket: '/tmp/m5.sock' })
expect(sent).toEqual({ sock: '/tmp/m5.sock', msg: { op: 'tap', x: 160, y: 120, duration_ms: 50 } })

await runTap(['160', '120', '--duration', '120'], io, { call, socket: '/tmp/m5.sock' })
expect(sent.msg).toEqual({ op: 'tap', x: 160, y: 120, duration_ms: 120 })
```

Expected output:

```ts
expect(stdout).toEqual(['Tapped: x=160 y=120 duration=120ms'])
expect(stderr).toEqual(['m5ct tap: out_of_bounds'])
```

Update `packages/cli/src/main.test.ts` expected command list and usage string to include `tap`.

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm vitest run packages/cli/src/cmd-tap.test.ts packages/cli/src/main.test.ts
```

Expected: fails because `cmd-tap.ts` and dispatch are missing.

- [ ] **Step 3: Implement `cmd-tap.ts`**

Create `packages/cli/src/cmd-tap.ts`:

```ts
import { callOnce, defaultSocket } from './control-client.js'
import type { CliIO } from './main.js'

interface TapResult {
  ok?: boolean
  error?: string
}

type TapCall = (sockPath: string, msg: object) => Promise<TapResult>

export interface TapOpts {
  call?: TapCall
  socket?: string
}

function parseIntArg(name: string, value: string | undefined): number {
  if (!value) throw new Error(`missing ${name}`)
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
  return Number(value)
}

function parseArgs(args: readonly string[]): { x: number; y: number; durationMs: number } {
  const positionals: string[] = []
  let durationMs = 50
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--duration') {
      const v = args[++i]
      if (!v) throw new Error('missing value after --duration')
      if (!/^(0|[1-9]\d*)$/.test(v)) throw new Error('duration must be an integer from 1 to 5000')
      durationMs = Number(v)
      if (durationMs < 1 || durationMs > 5000) {
        throw new Error('duration must be an integer from 1 to 5000')
      }
      continue
    }
    if (a.startsWith('-')) throw new Error(`unknown option: ${a}`)
    positionals.push(a)
  }
  if (positionals.length > 2) throw new Error(`unexpected argument: ${positionals[2]}`)
  return {
    x: parseIntArg('x', positionals[0]),
    y: parseIntArg('y', positionals[1]),
    durationMs,
  }
}

export async function runTap(
  args: readonly string[],
  io: CliIO,
  opts: TapOpts = {},
): Promise<number> {
  const call: TapCall = opts.call ?? ((s, m) => callOnce<TapResult>(s, m))
  const sock = opts.socket ?? defaultSocket()
  let parsed: { x: number; y: number; durationMs: number }
  try {
    parsed = parseArgs(args)
  } catch (err) {
    io.error(`m5ct tap: ${(err as Error).message}`)
    return 2
  }
  try {
    const r = await call(sock, {
      op: 'tap',
      x: parsed.x,
      y: parsed.y,
      duration_ms: parsed.durationMs,
    })
    if (r.ok) {
      io.log(`Tapped: x=${parsed.x} y=${parsed.y} duration=${parsed.durationMs}ms`)
      return 0
    }
    io.error(`m5ct tap: ${r.error ?? 'unknown error'}`)
    return 1
  } catch (err) {
    io.error(`m5ct tap: ${(err as Error).message}`)
    return 1
  }
}
```

- [ ] **Step 4: Wire command dispatch**

In `packages/cli/src/main.ts`, import `runTap`, add `tap` to `listCommands()`, and add:

```ts
case 'tap':
  return runTap(rest, io)
```

- [ ] **Step 5: Run CLI tests to verify pass**

Run:

```bash
pnpm vitest run packages/cli/src/cmd-tap.test.ts packages/cli/src/main.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit CLI changes**

```bash
git add packages/cli/src
git commit -m "feat(cli): add tap command"
```

## Task 3: Daemon Control Operation

**Files:**
- Modify: `packages/daemon/src/control-ops.ts`
- Modify: `packages/daemon/src/hook-server.ts`
- Modify: `packages/daemon/src/control-ops.test.ts`

- [ ] **Step 1: Write failing daemon tests**

In `packages/daemon/src/control-ops.test.ts`, add tests for:

```ts
expect(await makeControlHandler(dmWith(null)).tap(1, 2, 50)).toEqual({ error: 'no_device' })
expect(await makeControlHandler(dmWith(sessionOk)).tap(1, 2, 50)).toEqual({ ok: true })
expect(await makeControlHandler(dmWith(sessionTimeout)).tap(1, 2, 50)).toEqual({ error: 'device_timeout' })
expect(await makeControlHandler(dmWith(sessionOutOfBounds)).tap(999, 999, 50)).toEqual({ error: 'out_of_bounds' })
```

Also add HookServer socket coverage:

```ts
const ok = JSON.parse(await rpc(sock, { op: 'tap', x: 1, y: 2, duration_ms: 50 }))
expect(ok).toEqual({ ok: true })
const bad = JSON.parse(await rpc(sock, { op: 'tap', x: '1', y: 2, duration_ms: 50 }))
expect(bad).toEqual({ error: 'bad_request' })
```

Extend the `fakeDM` in the socket test setup with a `currentSession().request()` stub or a `tap()`-capable control stub so dispatch can return success.

- [ ] **Step 2: Run daemon tests to verify failure**

Run:

```bash
pnpm vitest run packages/daemon/src/control-ops.test.ts
```

Expected: fails because `tap` is not defined on `ControlHandler`.

- [ ] **Step 3: Implement control op**

Add to `ControlHandler` in `packages/daemon/src/control-ops.ts`:

```ts
tap(x: number, y: number, durationMs: number): Promise<{ ok: true } | { error: string }>
```

Add implementation in `makeControlHandler()`:

```ts
async tap(x: number, y: number, durationMs: number): Promise<{ ok: true } | { error: string }> {
  const sess = dm.currentSession()
  if (!sess) return { error: 'no_device' }
  let env: Awaited<ReturnType<typeof sess.request>>
  try {
    env = await sess.request({ k: 'tap', p: { x, y, duration_ms: durationMs } }, 3000)
  } catch (err) {
    const e = err as Error & { code?: string }
    return { error: e.code === 'ETIMEDOUT' ? 'device_timeout' : e.message }
  }
  const p = env.p as { ok?: boolean; err?: string }
  if (p.ok) return { ok: true }
  return { error: p.err ?? 'tap_failed' }
}
```

- [ ] **Step 4: Implement HookServer dispatch**

In `packages/daemon/src/hook-server.ts`, add a helper:

```ts
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
```

Add switch branch:

```ts
case 'tap': {
  if (!finiteNumber(msg.x) || !finiteNumber(msg.y) || !finiteNumber(msg.duration_ms)) {
    sock.end(`${JSON.stringify({ error: 'bad_request' })}\n`)
    return
  }
  const r = await this.control.tap(msg.x, msg.y, msg.duration_ms)
  sock.end(`${JSON.stringify(r)}\n`)
  return
}
```

- [ ] **Step 5: Run daemon tests to verify pass**

Run:

```bash
pnpm vitest run packages/daemon/src/control-ops.test.ts packages/daemon/src/hook-server.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit daemon changes**

```bash
git add packages/daemon/src
git commit -m "feat(daemon): add tap control op"
```

## Task 4: Firmware Tap Handling

**Files:**
- Modify: `firmware/lib/m5render/app.h`
- Modify: `firmware/lib/m5render/app.cpp`
- Modify: `firmware/lib/m5proto/codec.h`
- Modify: `firmware/test/test_app/test_main.cpp`

- [ ] **Step 1: Write failing firmware tests**

In `firmware/test/test_app/test_main.cpp`, add a board helper with display and input:

```cpp
static Board makeTouchBoard(MockTransport& t, m5hal::mock::MockDisplay& d, m5hal::mock::MockInput& i) {
  Board b = makeBoard(t);
  b.display = &d;
  b.input = &i;
  return b;
}
```

Add tests:

```cpp
void test_tap_returns_ack_with_matching_id() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* req = "{\"v\":1,\"k\":\"tap\",\"t\":0,\"id\":\"m2\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
  app.handleLine(req, std::strlen(req));
  std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"tap.ack\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"id\":\"m2\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"ok\":true") != std::string::npos);
}
```

Also add:

```cpp
void test_tap_advances_page_when_live();
void test_tap_does_not_advance_page_when_linked();
void test_tap_out_of_bounds_returns_error();
void test_tap_without_touch_returns_unsupported();
```

Use a new `App::page()` accessor to assert page changes:

```cpp
TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
```

- [ ] **Step 2: Run firmware tests to verify failure**

Run:

```bash
pnpm fw:test
```

Expected: native firmware tests fail because `tap` handling and `App::page()` are missing.

- [ ] **Step 3: Add firmware ack encoder**

In `firmware/lib/m5proto/codec.h`, add:

```cpp
inline std::string encode_tap_ack(const char* id, uint64_t t, bool ok, const char* err) {
  std::string s = "{\"v\":1";
  if (id && id[0]) { s += ",\"id\":\""; s += id; s += "\""; }
  s += ",\"k\":\""; s += kind::tap_ack; s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"ok\":";
  s += ok ? "true" : "false";
  if (!ok && err && err[0]) {
    s += ",\"err\":\""; s += err; s += "\"";
  }
  s += "}}";
  return s;
}
```

- [ ] **Step 4: Share app tap action**

In `firmware/lib/m5render/app.h`, add:

```cpp
PageId page() const { return page_; }  // test helper
void handleTouchTapAction(uint32_t t_ms);
```

In `firmware/lib/m5render/app.cpp`, update `pollInput()`:

```cpp
if (e.kind != m5hal::InputEvent::TouchTap) return;
handleTouchTapAction(e.t_ms);
```

Add:

```cpp
void App::handleTouchTapAction(uint32_t) {
    if (link_ != LinkState::Live) return;
    page_ = static_cast<PageId>((static_cast<int>(page_) + 1) % kPageCount);
    dirty_ = true;
}
```

- [ ] **Step 5: Handle inbound tap RPC**

In `App::handleLine()`, before the `status` branch, add:

```cpp
if (std::strcmp(env.kind, m5proto::kind::tap) == 0) {
    JsonObjectConst p = env.doc["p"].as<JsonObjectConst>();
    if (!p["x"].is<int>() || !p["y"].is<int>() || !p["duration_ms"].is<int>()) {
        std::string line = m5proto::encode_tap_ack(env.id, 0, false, "bad_request");
        send(line.c_str(), line.size());
        return;
    }
    int x = p["x"].as<int>();
    int y = p["y"].as<int>();
    if (!board_ || !board_->display || !board_->input || !board_->input->hasTouch()) {
        std::string line = m5proto::encode_tap_ack(env.id, 0, false, "touch_unsupported");
        send(line.c_str(), line.size());
        return;
    }
    if (x < 0 || y < 0 || x >= board_->display->width() || y >= board_->display->height()) {
        std::string line = m5proto::encode_tap_ack(env.id, 0, false, "out_of_bounds");
        send(line.c_str(), line.size());
        return;
    }
    handleTouchTapAction(now());
    std::string line = m5proto::encode_tap_ack(env.id, 0, true, nullptr);
    send(line.c_str(), line.size());
    return;
}
```

- [ ] **Step 6: Run firmware tests to verify pass**

Run:

```bash
pnpm fw:test
```

Expected: native firmware tests pass.

- [ ] **Step 7: Commit firmware changes**

```bash
git add firmware/lib/m5render/app.h firmware/lib/m5render/app.cpp firmware/lib/m5proto/codec.h firmware/test/test_app/test_main.cpp
git commit -m "feat(firmware): handle simulated tap rpc"
```

## Task 5: Fake Firmware Support

**Files:**
- Modify: `tools/fake-firmware/src/main.ts`
- Test: `tools/fake-firmware/src/main.test.ts`

- [ ] **Step 1: Write failing fake firmware test**

In `tools/fake-firmware/src/main.test.ts`, add a test that writes an encoded `tap` frame to the fake process and expects `tap.ack` with matching id.

Expected decoded response:

```ts
expect(reply.k).toBe('tap.ack')
expect(reply.id).toBe('m1')
expect(reply.p).toEqual({ ok: true })
```

- [ ] **Step 2: Run fake firmware tests to verify failure**

Run:

```bash
pnpm vitest run tools/fake-firmware/src/main.test.ts
```

Expected: fails because fake firmware ignores `tap`.

- [ ] **Step 3: Implement fake `tap` handler**

In `tools/fake-firmware/src/main.ts`, add before the `status` branch:

```ts
if (env.k === 'tap') {
  send(encode({ k: 'tap.ack', ...(env.id ? { id: env.id } : {}), p: { ok: true } }))
  return
}
```

- [ ] **Step 4: Run fake firmware tests to verify pass**

Run:

```bash
pnpm vitest run tools/fake-firmware/src/main.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit fake firmware changes**

```bash
git add tools/fake-firmware/src
git commit -m "feat(fake-firmware): acknowledge tap rpc"
```

## Task 6: End-To-End Verification

**Files:**
- No code changes expected unless verification exposes issues.

- [ ] **Step 1: Run generated message check**

Run:

```bash
pnpm gen:msgs:check
```

Expected: passes, proving `messages.h` is in sync.

- [ ] **Step 2: Run TypeScript tests**

Run:

```bash
pnpm test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: all packages typecheck.

- [ ] **Step 4: Run firmware native tests**

Run:

```bash
pnpm fw:test
```

Expected: PlatformIO native tests pass.

- [ ] **Step 5: Run lint**

Run:

```bash
pnpm lint
```

Expected: Biome check passes.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: clean worktree except ignored/unrelated files, with task commits visible.
