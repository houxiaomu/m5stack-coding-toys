# Status Badge Activity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the firmware's always-`WORKING` status badge with a real activity indicator (`working` / `awaiting_input` / `needs_attention`) driven by Claude Code hook events, shown via badge color + animation tempo; relocate the `CTX HIGH` warning off the badge.

**Architecture:** Claude Code hooks (`UserPromptSubmit`, `Stop`, `Notification`) invoke `m5ct-statusline --event <Name>`, which posts `{event}` to the daemon's UNIX socket. The daemon's `SessionAggregator` tracks `currentActivity`, stamps it on every status frame, and pushes the last frame immediately on a hook event. The firmware parses the `activity` enum and renders a colored, animated corner badge. Context-pressure warning already lives on the data-page tiles, so it is simply removed from the badge.

**Tech Stack:** TypeScript (zod protocol, daemon, CLI, statusline-shim; vitest), C++ (firmware lib `m5render`; PlatformIO Unity native tests).

**Spec:** `docs/superpowers/specs/2026-05-26-status-badge-activity-design.md`

**Conventions:**
- TS tests: vitest (`pnpm test`), files `*.test.ts` next to source.
- Firmware tests: `pnpm fw:test` (Unity, native env). MockCanvas records `text:<str>` etc. but NOT color, so color/label mapping is tested via pure helper functions, not by inspecting canvas calls.
- `docs/` is gitignored; commit docs with `git add -f`.
- Commit message footer line: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- After editing any TS package consumed by another (protocol), run `pnpm build` before integration tests that spawn binaries.

**Activity → label/color (single source of truth, used across tasks):**

| activity enum (TS) | C++ `Activity` | badge label | color      | tempo (ms) |
|--------------------|----------------|-------------|------------|------------|
| `working`          | `Working`        | `WORKING`   | `good`   | breathe 2000 |
| `awaiting_input`   | `AwaitingInput`  | `YOUR TURN` | `accent` | pulse 1200 |
| `needs_attention`  | `NeedsAttention` | `NEEDS YOU` | `warn`   | blink 500  |

CC hook → activity: `UserPromptSubmit`→`working`, `Stop`→`awaiting_input`, `Notification`→`needs_attention`.

---

## Task 1: Protocol — add `activity` to the status payload

**Files:**
- Modify: `packages/protocol/src/kinds.ts`
- Modify: `packages/protocol/src/messages-host.ts`
- Test: `packages/protocol/src/messages-host.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/protocol/src/messages-host.test.ts` (inside the existing top-level scope; it already imports `statusPayload` — if not, add `import { statusPayload } from './messages-host.js'` and `import { describe, expect, it } from 'vitest'`):

```ts
describe('statusPayload activity', () => {
  it('accepts the three activity values', () => {
    for (const activity of ['working', 'awaiting_input', 'needs_attention'] as const) {
      expect(statusPayload.safeParse({ state: 'active', activity }).success).toBe(true)
    }
  })

  it('rejects an unknown activity', () => {
    expect(statusPayload.safeParse({ state: 'active', activity: 'busy' }).success).toBe(false)
  })

  it('activity is optional and coexists with state', () => {
    const r = statusPayload.safeParse({ state: 'idle' })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @m5stack-coding-toys/protocol test`
Expected: FAIL — `activity: 'busy'` currently passes (zod ignores unknown keys), so the "rejects an unknown activity" assertion fails (`success` is `true`).

- [ ] **Step 3: Add the ACTIVITY constant**

In `packages/protocol/src/kinds.ts`, after the `STATES` block (around line 26), add:

```ts
// What Claude is doing right now, derived from CC hook events (orthogonal to
// `state` liveness). working = generating/running; awaiting_input = finished a
// turn, waiting for the user; needs_attention = blocked (e.g. permission prompt).
export const ACTIVITY = ['working', 'awaiting_input', 'needs_attention'] as const
export type Activity = (typeof ACTIVITY)[number]
```

- [ ] **Step 4: Add the field to the schema**

In `packages/protocol/src/messages-host.ts`:
- Change the import on line 2 from `import { CAPS, STATES, URGENCY } from './kinds.js'` to `import { ACTIVITY, CAPS, STATES, URGENCY } from './kinds.js'`.
- In `statusPayload` (the `z.object({...})` starting line 25), add this line right after `state: z.enum(STATES),`:

```ts
  activity: z.enum(ACTIVITY).optional(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @m5stack-coding-toys/protocol test`
Expected: PASS (all three new tests green, existing tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/kinds.ts packages/protocol/src/messages-host.ts packages/protocol/src/messages-host.test.ts
git commit -m "feat(protocol): add activity field to status payload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Firmware — parse `activity` into StatusModel

**Files:**
- Modify: `firmware/lib/m5render/status_model.h`
- Modify: `firmware/lib/m5render/status_model.cpp:13` (inside `parseStatusFrame`)
- Test: `firmware/test/test_status_model/test_main.cpp`

- [ ] **Step 1: Write the failing tests**

In `firmware/test/test_status_model/test_main.cpp`, add two test functions before `void setup()`:

```cpp
void test_activity_defaults_to_working_when_absent() {
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\"}", m));
  TEST_ASSERT_EQUAL(static_cast<int>(Activity::Working), static_cast<int>(m.activity));
}

void test_activity_parses_all_three_values() {
  StatusModel a;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\",\"activity\":\"working\"}", a));
  TEST_ASSERT_EQUAL(static_cast<int>(Activity::Working), static_cast<int>(a.activity));

  StatusModel b;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\",\"activity\":\"awaiting_input\"}", b));
  TEST_ASSERT_EQUAL(static_cast<int>(Activity::AwaitingInput), static_cast<int>(b.activity));

  StatusModel c;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\",\"activity\":\"needs_attention\"}", c));
  TEST_ASSERT_EQUAL(static_cast<int>(Activity::NeedsAttention), static_cast<int>(c.activity));
}
```

Register both in `setup()` with `RUN_TEST(test_activity_defaults_to_working_when_absent);` and `RUN_TEST(test_activity_parses_all_three_values);`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test`
Expected: FAIL — `Activity` type and `m.activity` do not exist (compile error).

- [ ] **Step 3: Add the enum and field**

In `firmware/lib/m5render/status_model.h`, inside `namespace m5render {` and before `struct StatusModel {` (around line 6), add:

```cpp
// What Claude is doing right now (mirrors protocol ACTIVITY). Drives the
// header badge color + animation. Defaults to Working when the host omits it.
enum class Activity : uint8_t { Working, AwaitingInput, NeedsAttention };
```

Inside `struct StatusModel`, after the `bool sessionActive = true;` line (line 9), add:

```cpp
  // Activity badge state + transient animation brightness (255 = full color,
  // 0 = faded to background). badgeBrightness is set by the app's animation
  // timer each frame; it is not parsed from the wire.
  Activity activity = Activity::Working;
  uint8_t  badgeBrightness = 255;
```

- [ ] **Step 4: Parse the field**

In `firmware/lib/m5render/status_model.cpp`, in `parseStatusFrame(JsonObjectConst doc, StatusModel& m)`, right after line 13 (`m.sessionActive = ...`), add:

```cpp
  {
    const char* act = doc["activity"] | "working";
    if (strcmp(act, "needs_attention") == 0) m.activity = Activity::NeedsAttention;
    else if (strcmp(act, "awaiting_input") == 0) m.activity = Activity::AwaitingInput;
    else m.activity = Activity::Working;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm fw:test`
Expected: PASS (new `test_status_model` cases green; all others still green).

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/m5render/status_model.h firmware/lib/m5render/status_model.cpp firmware/test/test_status_model/test_main.cpp
git commit -m "feat(firmware): parse activity enum into StatusModel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Firmware — activity label/color helpers + blend helper

**Files:**
- Modify: `firmware/lib/m5render/pages.h`
- Modify: `firmware/lib/m5render/pages.cpp`
- Test: `firmware/test/test_pages/test_main.cpp`

These pure helpers make the (untestable-via-MockCanvas) color choice testable directly.

- [ ] **Step 1: Write the failing tests**

In `firmware/test/test_pages/test_main.cpp`, add before `void setup()`:

```cpp
void test_activity_label_maps_each_state() {
  TEST_ASSERT_EQUAL_STRING("WORKING", activityLabel(Activity::Working));
  TEST_ASSERT_EQUAL_STRING("YOUR TURN", activityLabel(Activity::AwaitingInput));
  TEST_ASSERT_EQUAL_STRING("NEEDS YOU", activityLabel(Activity::NeedsAttention));
}

void test_activity_color_maps_each_state() {
  TEST_ASSERT_EQUAL_UINT16(color::good, activityColor(Activity::Working));
  TEST_ASSERT_EQUAL_UINT16(color::accent, activityColor(Activity::AwaitingInput));
  TEST_ASSERT_EQUAL_UINT16(color::warn, activityColor(Activity::NeedsAttention));
}

void test_blend565_endpoints_and_midpoint() {
  TEST_ASSERT_EQUAL_UINT16(0xF800, blend565(0xF800, 0x0000, 255)); // t=255 → fg
  TEST_ASSERT_EQUAL_UINT16(0x0000, blend565(0xF800, 0x0000, 0));   // t=0   → bg
  // midpoint: red(31,0,0) blended halfway toward black ≈ (15,0,0)
  TEST_ASSERT_EQUAL_UINT16(0x7800, blend565(0xF800, 0x0000, 128));
}
```

Register all three in `setup()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test`
Expected: FAIL — `activityLabel`, `activityColor`, `blend565` undefined (compile error).

- [ ] **Step 3: Declare the helpers**

In `firmware/lib/m5render/pages.h`, inside `namespace m5render {`, add declarations near the other free-function declarations (e.g. just above `void renderHeader(...)`):

```cpp
// Badge label/color for an activity (single source of truth for the header).
const char* activityLabel(Activity a);
uint16_t    activityColor(Activity a);
// Linear RGB565 blend: t=255 → fg, t=0 → bg, per 5/6/5 channel.
uint16_t    blend565(uint16_t fg, uint16_t bg, uint8_t t);
```

(`pages.h` already includes `status_model.h` and `canvas.h`; if not, add `#include "status_model.h"`.)

- [ ] **Step 4: Implement the helpers**

In `firmware/lib/m5render/pages.cpp`, near the top after the `kDash` definition (line 10), add:

```cpp
const char* activityLabel(Activity a) {
  switch (a) {
    case Activity::AwaitingInput:  return "YOUR TURN";
    case Activity::NeedsAttention: return "NEEDS YOU";
    default:                       return "WORKING";
  }
}

uint16_t activityColor(Activity a) {
  switch (a) {
    case Activity::AwaitingInput:  return color::accent;
    case Activity::NeedsAttention: return color::warn;
    default:                       return color::good;
  }
}

uint16_t blend565(uint16_t fg, uint16_t bg, uint8_t t) {
  auto lerp = [&](int a, int b) { return b + ((a - b) * t) / 255; };
  int rf = (fg >> 11) & 0x1F, gf = (fg >> 5) & 0x3F, bf = fg & 0x1F;
  int rb = (bg >> 11) & 0x1F, gb = (bg >> 5) & 0x3F, bb = bg & 0x1F;
  int r = lerp(rf, rb), g = lerp(gf, gb), b = lerp(bf, bb);
  return static_cast<uint16_t>((r << 11) | (g << 5) | b);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm fw:test`
Expected: PASS. (If the midpoint assertion is off by one due to rounding, adjust the expected literal to the actual computed value — `blend565(0xF800,0,128)` = `(15<<11)=0x7800`; recompute if you changed the lerp.)

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/m5render/pages.h firmware/lib/m5render/pages.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): add activity label/color + rgb565 blend helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Firmware — render the activity badge (remove WORKING/CTX HIGH literals)

**Files:**
- Modify: `firmware/lib/m5render/pages.cpp:13-39` (`renderHeader`)
- Test: `firmware/test/test_pages/test_main.cpp` (replace the two old badge tests)

- [ ] **Step 1: Update the tests (RED)**

In `firmware/test/test_pages/test_main.cpp`, replace `test_header_warning_badge_when_ctx_high` and `test_header_badge_working_when_no_warn` with:

```cpp
void test_header_badge_shows_working_by_default() {
  StatusModel m;  // default activity = Working
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "WORKING"));
}

void test_header_badge_shows_your_turn_when_awaiting() {
  StatusModel m; m.activity = Activity::AwaitingInput;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "YOUR TURN"));
  TEST_ASSERT_FALSE(c.called("text", "WORKING"));
}

void test_header_badge_shows_needs_you_when_attention() {
  StatusModel m; m.activity = Activity::NeedsAttention;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "NEEDS YOU"));
}

void test_header_badge_never_shows_ctx_high() {
  StatusModel m; m.hasContext = true; m.ctxUsedPct = 95; m.exceeds200k = true;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_FALSE(c.called("text", "CTX HIGH"));
}
```

Update `setup()`: remove the two `RUN_TEST` lines for the deleted tests; add `RUN_TEST` lines for the four new ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test`
Expected: FAIL — badge still renders `WORKING`/`CTX HIGH` from the old logic; `YOUR TURN`/`NEEDS YOU` not found.

- [ ] **Step 3: Rewrite the badge block in `renderHeader`**

In `firmware/lib/m5render/pages.cpp`, replace lines 25-34 (the `// State badge` comment through the `c.text(badge, ...)` call) with:

```cpp
  // Activity badge top-right. Color + label come from m.activity; brightness is
  // the app's animation phase (255 = full color). Context warning is NOT shown
  // here — the data-page context tiles already render warn color over threshold.
  const char* badge = activityLabel(m.activity);
  uint16_t bColor = blend565(activityColor(m.activity), color::bg, m.badgeBrightness);
  int bw = c.measureText(badge, Font::Label) + 8;
  c.fillRoundRect(316 - bw, 9, bw, 16, 3, color::accSoft);
  c.text(badge, 316 - bw / 2, 17, Font::Label, Align::MiddleCenter, bColor);
```

(This removes the `ctxWarn`, `bBg`, and `CTX HIGH` lines entirely.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm fw:test`
Expected: PASS (four new badge tests green; all other `test_pages` tests still green).

- [ ] **Step 5: Commit**

```bash
git add firmware/lib/m5render/pages.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): render activity badge, drop CTX HIGH from header

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Firmware — animation brightness + drive it from the app loop

**Files:**
- Modify: `firmware/lib/m5render/pages.h` (declare `badgeBrightnessFor`)
- Modify: `firmware/lib/m5render/pages.cpp` (implement it)
- Modify: `firmware/lib/m5render/app.h` (add `lastAnimMs_`)
- Modify: `firmware/lib/m5render/app.cpp` (`tick()` drives brightness)
- Test: `firmware/test/test_pages/test_main.cpp` (test the pure function)

- [ ] **Step 1: Write the failing test**

In `firmware/test/test_pages/test_main.cpp`, add before `setup()`:

```cpp
void test_badge_brightness_blink_is_high_contrast() {
  // needs_attention blinks ~500ms: full at phase start, low at half period.
  uint8_t on  = badgeBrightnessFor(Activity::NeedsAttention, 0);
  uint8_t off = badgeBrightnessFor(Activity::NeedsAttention, 250);
  TEST_ASSERT_TRUE(on > 200);
  TEST_ASSERT_TRUE(off < 80);
}

void test_badge_brightness_working_breathes_smoothly() {
  // working breathes ~2000ms: full near phase 0, dim near half period, never
  // fully off (calm, not a blink).
  uint8_t hi  = badgeBrightnessFor(Activity::Working, 0);
  uint8_t lo  = badgeBrightnessFor(Activity::Working, 1000);
  TEST_ASSERT_TRUE(hi > lo);
  TEST_ASSERT_TRUE(lo >= 60);  // floor so green stays visible
}
```

Register both in `setup()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm fw:test`
Expected: FAIL — `badgeBrightnessFor` undefined (compile error).

- [ ] **Step 3: Declare and implement `badgeBrightnessFor`**

In `firmware/lib/m5render/pages.h`, add near the other helper declarations:

```cpp
// Animation brightness (0..255) for an activity at wall-clock nowMs. Breathe
// for Working, gentle pulse for AwaitingInput, hard blink for NeedsAttention.
uint8_t badgeBrightnessFor(Activity a, uint32_t nowMs);
```

In `firmware/lib/m5render/pages.cpp`, add after the `blend565` definition:

```cpp
uint8_t badgeBrightnessFor(Activity a, uint32_t nowMs) {
  uint32_t period; uint8_t floorB;
  switch (a) {
    case Activity::NeedsAttention: period = 500;  floorB = 0;  break; // hard blink
    case Activity::AwaitingInput:  period = 1200; floorB = 100; break; // gentle pulse
    default:                       period = 2000; floorB = 60;  break; // calm breathe
  }
  // Triangle wave: 255 at phase 0, floorB at half period, back up.
  uint32_t t = nowMs % period;
  uint32_t half = period / 2;
  uint32_t up = t < half ? (half - t) : (t - half);   // 0..half, peak->trough->peak
  uint32_t span = 255 - floorB;
  return static_cast<uint8_t>(floorB + (span * up) / half);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm fw:test`
Expected: PASS.

- [ ] **Step 5: Drive brightness from the app loop**

In `firmware/lib/m5render/app.h`, add a member next to `lastRxMs_` (around line 47):

```cpp
    uint32_t              lastAnimMs_ = 0;
```

In `firmware/lib/m5render/app.cpp`, in `tick()` (after `checkLink();` on line 52, before the transport read block), add:

```cpp
    // Animate the activity badge: while Live, refresh brightness on a ~120ms
    // cadence so the breathe/pulse/blink advances without redrawing every loop.
    if (link_ == LinkState::Live && now() - lastAnimMs_ >= 120) {
        lastAnimMs_ = now();
        uint8_t b = badgeBrightnessFor(model_.activity, now());
        if (b != model_.badgeBrightness) {
            model_.badgeBrightness = b;
            dirty_ = true;
        }
    }
```

(`pages.h` is already included via `app.h`, so `badgeBrightnessFor` is in scope.)

- [ ] **Step 6: Run full firmware suite to verify nothing regressed**

Run: `pnpm fw:test`
Expected: PASS (all 56+ cases, including `test_app`).

- [ ] **Step 7: Commit**

```bash
git add firmware/lib/m5render/pages.h firmware/lib/m5render/pages.cpp firmware/lib/m5render/app.h firmware/lib/m5render/app.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): animate activity badge (breathe/pulse/blink)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Daemon — track activity and re-push on hook events

**Files:**
- Modify: `packages/daemon/src/session-aggregator.ts`
- Test: `packages/daemon/src/session-aggregator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/daemon/src/session-aggregator.test.ts` inside the `describe('SessionAggregator', ...)` block:

```ts
  it('stamps current activity on status frames (defaults to working)', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
    await agg.ingest({ model: { display_name: 'Sonnet 4.6' } })
    const frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.activity).toBe('working')
  })

  it('maps hook events to activity and re-pushes the last frame', async () => {
    const sess = fakeSession()
    const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
    await agg.ingest({ model: { display_name: 'Sonnet 4.6' } })
    sess.send.mockClear()

    await agg.ingestHookEvent('Stop')
    let frame = sess.send.mock.calls.at(-1)[0]
    expect(frame.p.activity).toBe('awaiting_input')
    // re-pushed full frame keeps prior data (model), not a blank frame
    expect(frame.p.model.short).toBe('Sonnet 4.6')

    await agg.ingestHookEvent('Notification')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')

    await agg.ingestHookEvent('UserPromptSubmit')
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })

  it('ignores hook events when no device session', async () => {
    const agg = new SessionAggregator(() => null, { enrich: async () => undefined } as never)
    await expect(agg.ingestHookEvent('Stop')).resolves.toBeUndefined()
  })

  it('resets activity to working when the session goes idle', async () => {
    const sess = fakeSession()
    const dead = () => false
    const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never, dead)
    await agg.ingest({ model: { display_name: 'X' } }, 4242)
    await agg.ingestHookEvent('Notification')
    agg.checkLiveness()
    sess.send.mockClear()
    await agg.ingest({ model: { display_name: 'X' } }, 4242)
    expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @m5stack-coding-toys/daemon test session-aggregator`
Expected: FAIL — `frame.p.activity` is `undefined`; `agg.ingestHookEvent` is not a function.

- [ ] **Step 3: Implement activity tracking**

In `packages/daemon/src/session-aggregator.ts`:

Change the import on line 1 to also pull the `Activity` type:

```ts
import type { Activity, StatusPayload } from '@m5stack-coding-toys/protocol'
```

Add private fields after `private sessionIdle = true` (line 40):

```ts
  private currentActivity: Activity = 'working'
  private lastFrame: StatusPayload | null = null
```

In `ingest`, change the `const frame: StatusPayload = { ...base, state: 'active', ... }` object: add `activity: this.currentActivity,` immediately after `state: 'active',`. Then, just before the `await session.send(...)` call, cache it:

```ts
    this.lastFrame = frame
```

After the `ingest` method (before `checkLiveness`), add:

```ts
  /** A Claude Code hook fired. Update activity and immediately re-push so the
   *  badge reflects it without waiting for the next statusLine tick. Re-sends
   *  the last full frame (data preserved) with the new activity stamped. */
  async ingestHookEvent(event: string): Promise<void> {
    const session = this.session()
    if (!session || !session.info) return
    const next = hookToActivity(event)
    if (!next) return
    this.currentActivity = next
    const frame: StatusPayload = this.lastFrame
      ? { ...this.lastFrame, activity: next }
      : { state: 'active', activity: next }
    this.lastFrame = frame
    await session.send({ k: 'status', p: frame }).catch((err) => {
      log.error('activity send failed', { error: (err as Error).message })
    })
  }
```

In `checkLiveness`, after setting `this.sessionIdle = true` (line 112), add:

```ts
    this.currentActivity = 'working'
    this.lastFrame = null
```

At the bottom of the file (next to `round2`), add the mapping helper:

```ts
function hookToActivity(event: string): Activity | null {
  switch (event) {
    case 'UserPromptSubmit': return 'working'
    case 'Stop': return 'awaiting_input'
    case 'Notification': return 'needs_attention'
    default: return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @m5stack-coding-toys/daemon test session-aggregator`
Expected: PASS (new cases green; existing aggregator tests still green — note the existing "builds a status frame" test now also has `activity: 'working'`, which it doesn't assert against, so it stays green).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/session-aggregator.ts packages/daemon/src/session-aggregator.test.ts
git commit -m "feat(daemon): track activity, re-push status frame on hook events

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Daemon — accept `{event}` frames on the socket and wire to the aggregator

**Files:**
- Modify: `packages/daemon/src/hook-server.ts`
- Modify: `packages/daemon/src/main.ts:102-108`
- Test: `packages/daemon/src/hook-server.test.ts` (create if absent)

Note: `hook-server.ts` already has an unrelated `onActivity`/`setActivityHandler` used for idle-timeout. Name the new path `HookEvent` to avoid collision.

- [ ] **Step 1: Write the failing test**

If `packages/daemon/src/hook-server.test.ts` does not exist, create it; otherwise add the case. Use a tmp socket path:

```ts
import { mkdtempSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookServer } from './hook-server.js'

function sockPath() {
  return resolve(mkdtempSync(resolve(tmpdir(), 'm5ct-hs-')), 'd.sock')
}

describe('HookServer hook events', () => {
  let srv: HookServer
  afterEach(async () => { await srv?.close() })

  it('routes {event} to the hook-event handler and acks', async () => {
    const path = sockPath()
    srv = new HookServer(path)
    const seen: string[] = []
    srv.setHookEventHandler((ev) => seen.push(ev))
    await srv.listen()

    const ack = await new Promise<string>((res) => {
      const s = connect(path, () => s.end(`${JSON.stringify({ event: 'Stop' })}\n`))
      let buf = ''
      s.on('data', (c) => { buf += c.toString() })
      s.on('close', () => res(buf))
    })
    expect(seen).toEqual(['Stop'])
    expect(JSON.parse(ack)).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @m5stack-coding-toys/daemon test hook-server`
Expected: FAIL — `srv.setHookEventHandler` is not a function.

- [ ] **Step 3: Add the handler and socket branch**

In `packages/daemon/src/hook-server.ts`:

Add a field next to `onActivity` (line 23):

```ts
  private onHookEvent: ((event: string) => void) | null = null
```

Add a setter next to `setActivityHandler` (after line 29):

```ts
  setHookEventHandler(fn: (event: string) => void): void {
    this.onHookEvent = fn
  }
```

In `process()`, add a branch after the `statusLine` block and before the `op` block (i.e. after line 107):

```ts
    const ev = (msg as { event?: unknown }).event
    if (typeof ev === 'string') {
      this.onHookEvent?.(ev)
      sock.end(`${JSON.stringify({ ok: true })}\n`)
      return
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @m5stack-coding-toys/daemon test hook-server`
Expected: PASS.

- [ ] **Step 5: Wire it in main.ts**

In `packages/daemon/src/main.ts`, after the `server.setStatusLineHandler(...)` call (ends line 104), add:

```ts
  server.setHookEventHandler((ev) => void aggregator.ingestHookEvent(ev))
```

- [ ] **Step 6: Build and run the daemon suite + e2e**

Run: `pnpm build && pnpm --filter @m5stack-coding-toys/daemon test`
Expected: PASS (e2e still green; the new wiring doesn't change statusLine behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/hook-server.ts packages/daemon/src/main.ts packages/daemon/src/hook-server.test.ts
git commit -m "feat(daemon): accept {event} frames and route to activity tracking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: statusline-shim — `--event` mode posts a hook event

**Files:**
- Modify: `packages/statusline-shim/src/main.ts`
- Test: `packages/statusline-shim/src/main.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/statusline-shim/src/main.test.ts` (it already uses vitest; add imports for the new exports):

```ts
import { buildHookPayload, parseEventFlag } from './main.js'

describe('--event flag', () => {
  it('parses a valid event name', () => {
    expect(parseEventFlag(['--event', 'Stop'])).toBe('Stop')
    expect(parseEventFlag(['--event', 'UserPromptSubmit'])).toBe('UserPromptSubmit')
    expect(parseEventFlag(['--event', 'Notification'])).toBe('Notification')
  })

  it('returns undefined for missing or unknown events', () => {
    expect(parseEventFlag([])).toBeUndefined()
    expect(parseEventFlag(['--event', 'Bogus'])).toBeUndefined()
    expect(parseEventFlag(['--event'])).toBeUndefined()
  })

  it('builds a hook payload with optional sessionId', () => {
    expect(buildHookPayload('Stop', 'sess-1')).toEqual({ event: 'Stop', sessionId: 'sess-1' })
    expect(buildHookPayload('Stop')).toEqual({ event: 'Stop' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @m5stack-coding-toys/statusline-shim test`
Expected: FAIL — `parseEventFlag` / `buildHookPayload` not exported.

- [ ] **Step 3: Add the pure helpers**

In `packages/statusline-shim/src/main.ts`, add after `buildDaemonPayload` (line 23):

```ts
const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'] as const
type HookEvent = (typeof HOOK_EVENTS)[number]

/** Extract a valid `--event <Name>` value, or undefined. */
export function parseEventFlag(args: readonly string[]): HookEvent | undefined {
  const i = args.indexOf('--event')
  if (i === -1) return undefined
  const v = args[i + 1]
  return (HOOK_EVENTS as readonly string[]).includes(v ?? '') ? (v as HookEvent) : undefined
}

/** The NDJSON frame the daemon expects for a hook event. */
export function buildHookPayload(event: HookEvent, sessionId?: string): Record<string, unknown> {
  return sessionId ? { event, sessionId } : { event }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @m5stack-coding-toys/statusline-shim test`
Expected: PASS.

- [ ] **Step 5: Branch `main()` on event mode**

In `packages/statusline-shim/src/main.ts`, at the very top of `async function main()` (line 69, before `const raw = await readStdin()`), add:

```ts
  const eventName = parseEventFlag(process.argv.slice(2))
```

Then wrap the socket send so event mode forwards `{event}` and skips the status-line summary. Replace the body of `main()` from the `readStdin` line through the end with:

```ts
  const raw = await readStdin()
  let cc: CC = {}
  try {
    cc = JSON.parse(raw)
  } catch {
    if (!eventName) process.stdout.write('m5ct ·\n')
    // event mode has no stdout contract; still try to fire below using parsed {}
  }
  const sockPath = process.env.M5CT_SOCKET ?? `${process.env.HOME}/.m5stack-coding-toys/daemon.sock`
  const payload = eventName
    ? buildHookPayload(eventName, cc.session_id)
    : buildDaemonPayload(cc, currentClaudePid())
  try {
    const sock = connect(sockPath)
    const timer = setTimeout(() => sock.destroy(), 500)
    timer.unref()
    sock.on('error', () => {})
    sock.on('close', () => clearTimeout(timer))
    sock.on('connect', () => {
      sock.end(`${JSON.stringify(payload)}\n`)
    })
  } catch {
    // ignore
  }
  ensureDaemon()
  if (eventName) return // hooks produce no status-line output
  const chained = chainedStatusLine()
  if (chained) {
    const passthrough = await runChained(chained, raw)
    process.stdout.write(passthrough ? `${passthrough}\n` : `${buildSummary(cc)}\n`)
  } else {
    process.stdout.write(`${buildSummary(cc)}\n`)
  }
```

Add `session_id?: string` to the `CC` interface (line 11-16) if not already present (it is — line 12 has `session_id?: string`).

- [ ] **Step 6: Build and run the shim suite**

Run: `pnpm build && pnpm --filter @m5stack-coding-toys/statusline-shim test`
Expected: PASS (statusLine path unchanged; event helpers green).

- [ ] **Step 7: Commit**

```bash
git add packages/statusline-shim/src/main.ts packages/statusline-shim/src/main.test.ts
git commit -m "feat(shim): --event mode posts a hook event to the daemon

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CLI — install/uninstall the three CC hooks

**Files:**
- Modify: `packages/cli/src/install.ts`
- Test: `packages/cli/src/install.test.ts`

The `hooks` key in `~/.claude/settings.json` is an object keyed by event name; each value is an array of matcher groups `{ hooks: [{ type, command }] }`. We add one group per event running `m5ct-statusline --event <Event>`, preserving any existing groups, and remove only ours on uninstall.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/install.test.ts`:

```ts
import { computeHooksPatch, computeHooksUninstall } from './install.js'

describe('hooks patch', () => {
  const events = ['UserPromptSubmit', 'Stop', 'Notification']

  it('adds a hook group per event when none exist', () => {
    const after = computeHooksPatch({}, 'm5ct-statusline')
    for (const ev of events) {
      const groups = after[ev] as Array<{ hooks: Array<{ command: string }> }>
      expect(groups[0].hooks[0].command).toBe(`m5ct-statusline --event ${ev}`)
    }
  })

  it('preserves existing hook groups for the same event', () => {
    const before = { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] }
    const after = computeHooksPatch(before, 'm5ct-statusline') as Record<string, unknown[]>
    const stop = after.Stop as Array<{ hooks: Array<{ command: string }> }>
    expect(stop.some((g) => g.hooks[0].command === 'other-tool')).toBe(true)
    expect(stop.some((g) => g.hooks[0].command === 'm5ct-statusline --event Stop')).toBe(true)
  })

  it('is idempotent: does not duplicate our group', () => {
    const once = computeHooksPatch({}, 'm5ct-statusline')
    const twice = computeHooksPatch(once, 'm5ct-statusline') as Record<string, unknown[]>
    expect((twice.Stop as unknown[]).length).toBe(1)
  })

  it('uninstall removes only our hook groups', () => {
    const before = {
      Stop: [
        { hooks: [{ type: 'command', command: 'other-tool' }] },
        { hooks: [{ type: 'command', command: 'm5ct-statusline --event Stop' }] },
      ],
    }
    const after = computeHooksUninstall(before, 'm5ct-statusline') as Record<string, unknown[]>
    const stop = after.Stop as Array<{ hooks: Array<{ command: string }> }>
    expect(stop.length).toBe(1)
    expect(stop[0].hooks[0].command).toBe('other-tool')
  })

  it('uninstall drops an event key left empty', () => {
    const before = {
      Notification: [{ hooks: [{ type: 'command', command: 'm5ct-statusline --event Notification' }] }],
    }
    const after = computeHooksUninstall(before, 'm5ct-statusline') as Record<string, unknown>
    expect(after.Notification).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @m5stack-coding-toys/cli test install`
Expected: FAIL — `computeHooksPatch` / `computeHooksUninstall` not exported.

- [ ] **Step 3: Implement the hooks helpers**

In `packages/cli/src/install.ts`, add after `computeInstallPatch` (line 52):

```ts
export const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'] as const

interface HookGroup {
  hooks: { type: string; command: string }[]
  [k: string]: unknown
}

function hookCommand(bin: string, event: string): string {
  return `${bin} --event ${event}`
}

/** Merge our three CC hooks into an existing `hooks` object, preserving others
 *  and never duplicating our own group. Returns the new hooks object. */
export function computeHooksPatch(
  before: Record<string, unknown>,
  bin: string,
): Record<string, unknown> {
  const after: Record<string, unknown> = { ...before }
  for (const event of HOOK_EVENTS) {
    const cmd = hookCommand(bin, event)
    const groups = (Array.isArray(after[event]) ? [...(after[event] as HookGroup[])] : []) as HookGroup[]
    const already = groups.some((g) => g.hooks?.some((h) => h.command === cmd))
    if (!already) groups.push({ hooks: [{ type: 'command', command: cmd }] })
    after[event] = groups
  }
  return after
}

/** Remove only our hook groups; drop an event key that ends up empty. */
export function computeHooksUninstall(
  before: Record<string, unknown>,
  bin: string,
): Record<string, unknown> {
  const after: Record<string, unknown> = { ...before }
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(after[event])) continue
    const cmd = hookCommand(bin, event)
    const kept = (after[event] as HookGroup[]).filter(
      (g) => !g.hooks?.some((h) => h.command === cmd),
    )
    if (kept.length > 0) after[event] = kept
    else delete after[event]
  }
  return after
}
```

- [ ] **Step 4: Wire hooks into the install/uninstall patches**

In `computeInstallPatch` (around line 47), after `after = { ...before, statusLine: desired }` is computed, also merge hooks. Replace the `return` block so hooks are always merged (idempotent), regardless of whether statusLine changed:

```ts
  const existingHooks = (after.hooks as Record<string, unknown>) ?? {}
  const hooks = computeHooksPatch(existingHooks, statusLineBin)
  after = { ...after, hooks }
  for (const event of HOOK_EVENTS) {
    added.push({ field: `hooks.${event}`, command: hookCommand(statusLineBin, event) })
  }

  return { path, before, after, added, chainedCommand }
```

(Move the `after` declaration so it is mutable before this block; it already is `let after`. Ensure `hookCommand` is in scope — it's defined above.)

In `computeUninstall` (line 61), after computing `after`, also strip hooks:

```ts
  if (after.hooks && typeof after.hooks === 'object') {
    after.hooks = computeHooksUninstall(after.hooks as Record<string, unknown>, 'm5ct-statusline')
    if (Object.keys(after.hooks as Record<string, unknown>).length === 0) after.hooks = undefined
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @m5stack-coding-toys/cli test install`
Expected: PASS. Note: the existing "is idempotent" install test asserts `patch.added.length` — update that assertion if it now counts hook entries. The original idempotent test expected `added.length === 0` when statusLine already present; since hooks are always appended to `added`, change that test's expectation to `added.length === 3` (the three hook fields) OR adjust `computeInstallPatch` to only push hook `added` entries when the hook was newly added. Prefer the latter: track per-event newly-added inside `computeHooksPatch` is overkill — instead, in `computeInstallPatch`, only push the `hooks.<event>` added entry when `existingHooks` lacked our command for that event. Implement that refinement and keep the existing idempotent test asserting `0`.

- [ ] **Step 6: Run the full CLI suite**

Run: `pnpm --filter @m5stack-coding-toys/cli test`
Expected: PASS (no other install test regressed; `main.test.ts` still green).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/install.ts packages/cli/src/install.test.ts
git commit -m "feat(cli): install/uninstall CC hooks for activity events

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verification

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: all packages build (`built m5ct, m5ctd, m5ct-statusline`).

- [ ] **Step 2: Run the whole TS suite**

Run: `pnpm test`
Expected: all files pass (211 + new cases, 0 failures).

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (If `pnpm gen:msgs:check` is part of CI and the generated message sources reference the payload, run `pnpm gen:msgs` and commit any regenerated output.)

- [ ] **Step 4: Run the firmware suite**

Run: `pnpm fw:test`
Expected: all native test cases pass.

- [ ] **Step 5: Commit any generated-message updates (if produced)**

```bash
git status --porcelain
# if gen:msgs produced changes:
git add -A && git commit -m "chore: regenerate messages for activity field

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
