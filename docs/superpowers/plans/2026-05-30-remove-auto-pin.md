# Remove Multi-Session Auto Pin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除多 session 的 auto/pin 模式，把设备交互改为 Sessions picker 显式选择 session。

**Architecture:** Daemon 继续维护所有 live session 和每个 session 的最新 frame，但 foreground 只由设备选择或 selected session 消失决定，hook activity 不再抢占。固件把多 session UI 改成 picker-owned navigation：Sessions 页用 3 行大触摸目标和底部 `NEXT n/m` 分页，详情页 header 可回 picker。协议删除新输出中的 `AUTO`、`pinned`、`auto` 和 `target:'auto'`。

**Tech Stack:** TypeScript, Zod, Vitest, C++ firmware, ArduinoJson, Unity native tests, Biome, PlatformIO.

---

## File Map

- Modify `packages/protocol/src/messages-host.ts`: remove `focusMode`, `focus`, `pinned`, and `auto` from status schema.
- Modify `packages/protocol/src/messages-host.test.ts`: assert new sessions schema and absence of auto/pin fields.
- Modify `packages/protocol/src/messages-device.ts`: remove `target:'auto'` focus event from schema.
- Modify `packages/protocol/src/messages-device.test.ts`: update focus event tests.
- Modify `packages/daemon/src/router.ts`: route only `target:'session'`.
- Modify `packages/daemon/src/router.test.ts`: remove auto focus route coverage.
- Modify `packages/daemon/src/session-aggregator.ts`: replace focusMode/pinnedSlotId with selectedSlotId and stable selection.
- Modify `packages/daemon/src/session-aggregator.test.ts`: cover no AUTO row, no pinned, no hook-driven auto switch, device selection.
- Modify `firmware/lib/m5hal/m5hal.h`: add `x` and `y` to `InputEvent`.
- Modify `firmware/boards/cores3_se/input_touch.cpp`: populate `x/y` from `M5.Touch.getDetail()`.
- Modify `firmware/lib/m5proto/codec.h`: remove `encode_focus_event_auto`.
- Modify `firmware/lib/m5render/status_model.h`: remove focus/pinned/auto fields, add picker page state.
- Modify `firmware/lib/m5render/status_model.cpp`: parse real sessions only, clamp picker page.
- Modify `firmware/lib/m5render/pages.h`: expose sessions hit-test constants/helpers if needed.
- Modify `firmware/lib/m5render/pages.cpp`: render 3-row Sessions picker and bottom `NEXT n/m`.
- Modify `firmware/lib/m5render/app.h`: replace region-based tap helpers with coordinate-based helpers.
- Modify `firmware/lib/m5render/app.cpp`: implement coordinate hit testing, header-to-picker, NEXT paging, row selection.
- Modify `firmware/test/test_status_model/test_main.cpp`: update parser expectations.
- Modify `firmware/test/test_pages/test_main.cpp`: update Sessions rendering expectations.
- Modify `firmware/test/test_app/test_main.cpp`: add coordinate navigation tests.
- Modify `README.md` and `docs/architecture/status-display.md`: update multi-session description.

## Task 1: Protocol And Router Contract

**Files:**
- Modify: `packages/protocol/src/messages-host.ts`
- Modify: `packages/protocol/src/messages-host.test.ts`
- Modify: `packages/protocol/src/messages-device.ts`
- Modify: `packages/protocol/src/messages-device.test.ts`
- Modify: `packages/daemon/src/router.ts`
- Modify: `packages/daemon/src/router.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Update `packages/protocol/src/messages-host.test.ts` so the multi-session payload uses only real sessions:

```ts
expect(
  statusPayload.parse({
    state: 'active',
    sessions: [{ index: 1, id: 's1', name: 'm5toys', activity: 'working' }],
  }).sessions,
).toEqual([{ index: 1, id: 's1', name: 'm5toys', activity: 'working' }])

expect(
  statusPayload.safeParse({
    state: 'active',
    sessions: [{ index: 0, id: 'auto', name: 'AUTO', activity: 'working', auto: true }],
  }).success,
).toBe(false)

expect(
  statusPayload.safeParse({
    state: 'active',
    focus: { mode: 'pinned', index: 1, total: 2 },
  }).success,
).toBe(false)
```

Update `packages/protocol/src/messages-device.test.ts` so `target:'auto'` is rejected and `target:'session'` remains valid:

```ts
expect(deviceEventPayload.parse({ kind: 'focus', target: 'session', sessionId: 's1' })).toEqual({
  kind: 'focus',
  target: 'session',
  sessionId: 's1',
})
expect(deviceEventPayload.safeParse({ kind: 'focus', target: 'auto' }).success).toBe(false)
```

- [ ] **Step 2: Run protocol tests and verify RED**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts packages/protocol/src/messages-device.test.ts
```

Expected: FAIL because current schema still accepts `focus`, `auto`, `pinned`, and `target:'auto'`.

- [ ] **Step 3: Implement protocol schema changes**

In `packages/protocol/src/messages-host.ts`, make session summaries strict and remove focus:

```ts
const sessionSummary = z
  .object({
    index: nonNegInt,
    id: z.string().min(1),
    name: z.string().min(1).max(40),
    activity: z.enum(ACTIVITY),
    selected: z.boolean().optional(),
  })
  .strict()
```

Remove `focusMode` and the `focus` property from `statusPayload`.

In `packages/protocol/src/messages-device.ts`, remove the auto arm:

```ts
const focusDeviceEventPayload = z
  .object({
    kind: z.literal('focus'),
    target: z.literal('session'),
    sessionId: z.string().min(1),
  })
  .strict()
```

- [ ] **Step 4: Write failing router tests**

Update `packages/daemon/src/router.test.ts`:

```ts
it('routes focus session device events', async () => {
  const calls: unknown[] = []
  const router = new Router((focus) => calls.push(focus))
  await router.handleDeviceEvent({
    v: 1,
    k: 'device.event',
    t: 0,
    p: { kind: 'focus', target: 'session', sessionId: 's2' },
  } as never)
  expect(calls).toEqual([{ target: 'session', sessionId: 's2' }])
})

it('ignores legacy focus auto device events', async () => {
  const calls: unknown[] = []
  const router = new Router((focus) => calls.push(focus))
  await router.handleDeviceEvent({
    v: 1,
    k: 'device.event',
    t: 0,
    p: { kind: 'focus', target: 'auto' },
  } as never)
  expect(calls).toEqual([])
})
```

- [ ] **Step 5: Implement router changes**

In `packages/daemon/src/router.ts`, change the type and remove the auto branch:

```ts
export type FocusRequest = { target: 'session'; sessionId: string }

if (p.kind === 'focus' && p.target === 'session' && typeof p.sessionId === 'string') {
  await this.onFocus?.({ target: 'session', sessionId: p.sessionId })
  return
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts packages/protocol/src/messages-device.test.ts packages/daemon/src/router.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/protocol/src/messages-host.ts packages/protocol/src/messages-host.test.ts packages/protocol/src/messages-device.ts packages/protocol/src/messages-device.test.ts packages/daemon/src/router.ts packages/daemon/src/router.test.ts
git commit -m "feat(protocol): remove multi-session auto pin contract"
```

## Task 2: Daemon Stable Session Selection

**Files:**
- Modify: `packages/daemon/src/session-aggregator.ts`
- Modify: `packages/daemon/src/session-aggregator.test.ts`
- Modify: `packages/daemon/src/main.ts` if type import requires adjustment

- [ ] **Step 1: Write failing daemon tests**

Update `packages/daemon/src/session-aggregator.test.ts` with these behaviors:

```ts
it('emits only real sessions without auto or pinned fields', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', workspace: { current_dir: '/repo/a' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', workspace: { current_dir: '/repo/b' } }, 222, () => 2000)
  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.focus).toBeUndefined()
  expect(frame.p.sessions.map((s: { id: string }) => s.id)).toEqual(['pid:111', 'pid:222'])
  expect(frame.p.sessions.some((s: { auto?: boolean; pinned?: boolean }) => s.auto || s.pinned)).toBe(false)
})

it('does not interrupt selected session when another session needs attention', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)
  await agg.setFocus({ target: 'session', sessionId: 'pid:111' })
  await agg.ingestHookEvent('Notification', 's2')
  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.model.short).toBe('A')
  expect(frame.p.sessions.find((s: { id: string }) => s.id === 'pid:222').activity).toBe('needs_attention')
})

it('selects a session from a device focus event', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)
  await agg.setFocus({ target: 'session', sessionId: 'pid:222' })
  expect(sess.send.mock.calls.at(-1)[0].p.model.short).toBe('B')
})
```

- [ ] **Step 2: Run daemon tests and verify RED**

Run:

```bash
pnpm vitest run packages/daemon/src/session-aggregator.test.ts
```

Expected: FAIL because current output includes `AUTO`, `focus`, and `pinned`, and auto mode can switch on `needs_attention`.

- [ ] **Step 3: Implement stable selected slot**

In `packages/daemon/src/session-aggregator.ts`:

- Replace `focusMode`, `pinnedSlotId`, and `foregroundSlotId` with `selectedSlotId`.
- Change `FocusRequest` to session only.
- `setFocus()` sets `selectedSlotId` if the slot exists.
- `selectForeground()` returns selected slot if present; otherwise first live slot.
- Remove the `needs_attention` auto foreground branch.
- `decorateFrame()` emits real sessions only:

```ts
private decorateFrame(base: StatusPayload, selected: TerminalSlot): StatusPayload {
  const stamped: StatusPayload = {
    ...base,
    today: { costUsd: round2(this.currentTodayCost()), sessions: this.todaySessions.size },
  }
  const live = this.orderedSlots()
  if (live.length < 2) return stamped
  const names = this.displayNames(live)
  return {
    ...stamped,
    sessions: live.slice(0, 8).map((s, i) => ({
      index: i + 1,
      id: s.id,
      name: names.get(s.id) ?? this.sessionName(s),
      activity: s.activity,
      selected: s.id === selected.id,
    })),
  }
}
```

- [ ] **Step 4: Run daemon tests and commit**

Run:

```bash
pnpm vitest run packages/daemon/src/session-aggregator.test.ts packages/daemon/src/router.test.ts
```

Expected: PASS.

Commit:

```bash
git add packages/daemon/src/session-aggregator.ts packages/daemon/src/session-aggregator.test.ts packages/daemon/src/main.ts
git commit -m "feat(daemon): stabilize multi-session selection"
```

## Task 3: Firmware Touch Coordinates And Status Model

**Files:**
- Modify: `firmware/lib/m5hal/m5hal.h`
- Modify: `firmware/boards/cores3_se/input_touch.cpp`
- Modify: `firmware/lib/m5proto/codec.h`
- Modify: `firmware/lib/m5render/status_model.h`
- Modify: `firmware/lib/m5render/status_model.cpp`
- Modify: `firmware/test/test_status_model/test_main.cpp`

- [ ] **Step 1: Write failing status model tests**

Update `firmware/test/test_status_model/test_main.cpp` to parse real sessions only:

```cpp
void test_parse_sessions_without_auto_pin() {
  StatusModel m;
  const char* json =
    "{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"pid:111\",\"name\":\"repo-a\",\"activity\":\"working\",\"selected\":true},"
    "{\"index\":2,\"id\":\"pid:222\",\"name\":\"repo-b\",\"activity\":\"needs_attention\"}"
    "]}";
  TEST_ASSERT_TRUE(parseStatusFrame(json, m));
  TEST_ASSERT_EQUAL(2, m.sessionN);
  TEST_ASSERT_EQUAL_STRING("pid:111", m.sessions[0].id);
  TEST_ASSERT_TRUE(m.sessions[0].selected);
  TEST_ASSERT_EQUAL_STRING("pid:222", m.sessions[1].id);
  TEST_ASSERT_EQUAL(static_cast<int>(Activity::NeedsAttention),
                    static_cast<int>(m.sessions[1].activity));
}
```

Remove assertions that depend on `focusPinned`, `pinned`, or `autoMode`.

- [ ] **Step 2: Run native status model test and verify RED**

Run:

```bash
pio test --project-dir firmware -e native -f test_status_model
```

Expected: FAIL while old tests still expect auto/pin fields or new fields do not exist.

- [ ] **Step 3: Implement model and coordinate data**

In `firmware/lib/m5hal/m5hal.h`, extend `InputEvent`:

```cpp
struct InputEvent {
    enum Kind : uint8_t { ButtonPress = 0, ButtonRelease = 1, KeyChar = 2, TouchTap = 3, Shake = 4 };
    Kind     kind;
    uint16_t code;
    int16_t  x;
    int16_t  y;
    uint32_t t_ms;
};
```

In `firmware/boards/cores3_se/input_touch.cpp`, preserve coordinates:

```cpp
out.kind = m5hal::InputEvent::TouchTap;
out.code = 0;
out.x = static_cast<int16_t>(t.x);
out.y = static_cast<int16_t>(t.y);
out.t_ms = millis();
```

In `firmware/lib/m5render/status_model.h`, remove focus/pinned/auto members and add:

```cpp
int sessionPageIndex = 0;
```

Keep `selected` in `SessionSummary`; remove `pinned` and `autoMode`.

In `status_model.cpp`, parse `selected`, ignore unknown old fields, and clamp `sessionPageIndex`:

```cpp
const int maxPage = m.sessionN > 0 ? (m.sessionN - 1) / 3 : 0;
if (m.sessionPageIndex > maxPage) m.sessionPageIndex = maxPage;
```

Remove focus parsing.

- [ ] **Step 4: Run status model test and commit**

Run:

```bash
pio test --project-dir firmware -e native -f test_status_model
```

Expected: PASS.

Commit:

```bash
git add firmware/lib/m5hal/m5hal.h firmware/boards/cores3_se/input_touch.cpp firmware/lib/m5proto/codec.h firmware/lib/m5render/status_model.h firmware/lib/m5render/status_model.cpp firmware/test/test_status_model/test_main.cpp
git commit -m "feat(firmware): parse picker sessions without auto pin"
```

## Task 4: Firmware Picker Rendering And Navigation

**Files:**
- Modify: `firmware/lib/m5render/pages.cpp`
- Modify: `firmware/lib/m5render/pages.h`
- Modify: `firmware/lib/m5render/app.h`
- Modify: `firmware/lib/m5render/app.cpp`
- Modify: `firmware/test/test_pages/test_main.cpp`
- Modify: `firmware/test/test_app/test_main.cpp`

- [ ] **Step 1: Write failing page tests**

Update `firmware/test/test_pages/test_main.cpp`:

```cpp
void test_sessions_page_renders_three_rows_and_next() {
  StatusModel m;
  DeviceInfo d;
  m.sessionN = 4;
  strcpy(m.sessions[0].name, "repo-a");
  strcpy(m.sessions[1].name, "repo-b");
  strcpy(m.sessions[2].name, "repo-c");
  strcpy(m.sessions[3].name, "repo-d");
  MockCanvas c;
  renderPage(PageId::Sessions, m, d, c);
  TEST_ASSERT_TRUE(c.containsText("repo-a"));
  TEST_ASSERT_TRUE(c.containsText("repo-b"));
  TEST_ASSERT_TRUE(c.containsText("repo-c"));
  TEST_ASSERT_FALSE(c.containsText("repo-d"));
  TEST_ASSERT_TRUE(c.containsText("NEXT 1/2"));
}
```

Adjust helper calls to match the existing `MockCanvas` API.

- [ ] **Step 2: Write failing app navigation tests**

Update `firmware/test/test_app/test_main.cpp`:

```cpp
void test_sessions_page_tap_row_selects_session() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\",\"selected\":true},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
  const char* row2 =
    "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"r2\",\"p\":{\"x\":160,\"y\":104,\"duration_ms\":50}}";
  app.handleLine(row2, std::strlen(row2));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"target\":\"session\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"sessionId\":\"s2\"") != std::string::npos);
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
}
```

Add tests for empty tap no-op, NEXT paging, header return, and Workspace returning to Sessions.

- [ ] **Step 3: Run firmware tests and verify RED**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
pio test --project-dir firmware -e native -f test_app
```

Expected: FAIL because current app uses top/bottom region taps and renders 5 compact rows.

- [ ] **Step 4: Implement Sessions rendering**

In `pages.cpp`, render the picker with:

- row start `y=46`
- row height `44`
- row gap `8`
- visible rows `3`
- page count `(sessionN + 2) / 3`
- start index `sessionPageIndex * 3`
- bottom center text `NEXT n/m` when page count is greater than 1

Do not call `renderFooter()` on Sessions; render date and clock, but replace dots with `NEXT n/m`.

- [ ] **Step 5: Implement coordinate navigation**

In `App`, replace region helpers with:

```cpp
void handleTouchTapAction(int16_t x, int16_t y, uint32_t t_ms);
void handleSessionsTap(int16_t x, int16_t y, uint32_t t_ms);
```

For `tap` RPC, call these with payload coordinates. For HAL input, call with `e.x/e.y`.

Hit testing:

- Sessions row area: `x=10..310`, `y=46..90`, `98..142`, `150..194`.
- NEXT area: `x=90..230`, `y=190..239`.
- Header detail return: `y=0..34`, only when page is not Sessions and `hasSessionsPage(model_)`.
- Detail content tap: current four-page cycle; if page is Workspace and `hasSessionsPage(model_)`, return Sessions.

On row selection, send `encode_focus_event_session(t_ms, s.id)` and set page to Overview.

- [ ] **Step 6: Run firmware tests and commit**

Run:

```bash
pio test --project-dir firmware -e native -f test_status_model
pio test --project-dir firmware -e native -f test_pages
pio test --project-dir firmware -e native -f test_app
```

Expected: PASS.

Commit:

```bash
git add firmware/lib/m5render/pages.cpp firmware/lib/m5render/pages.h firmware/lib/m5render/app.h firmware/lib/m5render/app.cpp firmware/test/test_pages/test_main.cpp firmware/test/test_app/test_main.cpp
git commit -m "feat(firmware): add multi-session picker navigation"
```

## Task 5: Docs And Whole-Project Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/status-display.md`

- [ ] **Step 1: Update docs**

In `README.md`, replace the auto/pin sentence with:

```md
When multiple Claude Code sessions are live, the device shows a Sessions picker.
Tap a session to inspect its four detail pages; other sessions that need
attention are shown in the picker without interrupting the current detail view.
```

In `docs/architecture/status-display.md`, add the picker behavior to the data-flow section and remove auto/pin wording.

- [ ] **Step 2: Run formatting and full verification**

Run:

```bash
pnpm lint:fix
pnpm test
pnpm build
pnpm gen:msgs:check
pio test --project-dir firmware -e native
pio run --project-dir firmware -e native
```

Expected: all pass.

- [ ] **Step 3: Commit docs and formatting**

Commit:

```bash
git add README.md docs/architecture/status-display.md
git add packages firmware tools
git commit -m "docs: update multi-session picker behavior"
```

## Self-Review Notes

- Spec coverage: protocol auto/pin removal is Task 1; daemon stable selection is Task 2; firmware coordinate picker, NEXT, header return, and no empty-area action are Task 4; docs are Task 5.
- No placeholders remain; each task has concrete files, commands, and expected results.
- Type consistency: host selection remains named `FocusRequest` for minimal churn, but only supports `{ target:'session'; sessionId:string }`.
