# Multi Claude Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build multi-Claude-session support with Auto/Pinned focus, a Sessions picker page, and stable foreground selection.

**Architecture:** Keep one host-to-device `status` frame, but make the daemon maintain a registry of live Claude sessions keyed by `session_id`. The selected foreground session populates the existing detail fields; additive `focus` and `sessions` metadata lets firmware render mode labels and the picker.

**Tech Stack:** TypeScript packages (`protocol`, `daemon`, `statusline-shim`, `cli`) with Vitest; generated C++ protocol constants; firmware C++ with Unity native tests.

---

## File Structure

- Modify `packages/protocol/src/messages-host.ts`: add optional `focus` and `sessions` groups to `statusPayload`.
- Modify `packages/protocol/src/messages-device.ts`: extend `device.event` to accept focus selection events.
- Do not add new protocol kind strings; reuse `status` and `device.event`.
- Run `pnpm gen:msgs`; include `firmware/lib/m5proto/messages.h` in the commit when the generator changes it.
- Modify `packages/statusline-shim/src/main.ts`: include `sessionId` for hook payloads; existing helper already supports it.
- Modify `packages/daemon/src/hook-server.ts`: pass `sessionId` into hook event handlers.
- Modify `packages/daemon/src/router.ts`: turn `device.event` focus payloads into daemon focus updates.
- Modify `packages/daemon/src/main.ts`: wire router to the session aggregator.
- Replace/refactor `packages/daemon/src/session-aggregator.ts`: store per-session state and foreground selector.
- Modify `packages/daemon/src/session-aggregator.test.ts`: cover multi-session registry, Auto/Pinned, liveness, hooks, and today totals.
- Modify `packages/daemon/src/router.test.ts` and `packages/daemon/src/hook-server.test.ts`: cover focus event and hook session ids.
- Modify `firmware/lib/m5render/status_model.h/.cpp`: parse focus metadata and session list into fixed-size firmware state.
- Modify `firmware/lib/m5render/pages.h/.cpp`: add `Sessions` page, conditional page count helpers, focus label rendering, cost label changes.
- Modify `firmware/lib/m5render/app.h/.cpp`: support dynamic page cycle and picker local selection/commit events.
- Modify `firmware/lib/m5proto/m5proto.cpp`: add focused helpers for encoding `device.event` focus payloads.
- Modify native firmware tests under `firmware/test/test_status_model`, `firmware/test/test_pages`, and `firmware/test/test_app`.
- Modify integration tests in `packages/daemon/src/e2e.test.ts` to observe focus metadata and focus events.

---

## Task 1: Protocol Schemas for Focus Metadata

**Files:**
- Modify: `packages/protocol/src/messages-host.ts`
- Modify: `packages/protocol/src/messages-device.ts`
- Test: `packages/protocol/src/messages-device.test.ts`
- Test: `packages/protocol/src/messages-host.test.ts` or existing protocol status tests

- [ ] **Step 1: Write failing protocol tests**

Add tests that validate new status metadata and focus device events:

```ts
import { describe, expect, it } from 'vitest'
import { decode, encode } from './index.js'

describe('multi-session status metadata', () => {
  it('accepts focus and sessions on status payloads', () => {
    const wire = encode({
      k: 'status',
      p: {
        state: 'active',
        activity: 'working',
        focus: { mode: 'auto', index: 2, total: 4 },
        sessions: [
          { index: 0, id: 'auto', name: 'AUTO', activity: 'working', auto: true, selected: false },
          { index: 1, id: 's1', name: 'm5toys', activity: 'needs_attention', selected: true },
        ],
      },
    })
    expect(decode(wire).p).toMatchObject({
      focus: { mode: 'auto', index: 2, total: 4 },
      sessions: [{ id: 'auto' }, { id: 's1', activity: 'needs_attention' }],
    })
  })

  it('rejects invalid focus mode', () => {
    expect(() =>
      encode({
        k: 'status',
        p: { state: 'active', focus: { mode: 'manual', index: 1, total: 2 } },
      } as never),
    ).toThrow()
  })
})

describe('device focus event', () => {
  it('accepts selecting auto focus', () => {
    const wire = encode({ k: 'device.event', p: { kind: 'focus', target: 'auto' } })
    expect(decode(wire).p).toEqual({ kind: 'focus', target: 'auto' })
  })

  it('accepts selecting a session focus target', () => {
    const wire = encode({
      k: 'device.event',
      p: { kind: 'focus', target: 'session', sessionId: 's1' },
    })
    expect(decode(wire).p).toEqual({ kind: 'focus', target: 'session', sessionId: 's1' })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run packages/protocol/src/messages-device.test.ts packages/protocol/src/messages-host.test.ts`

Expected: failures because `focus`, `sessions`, and `kind:'focus'` are not accepted.

- [ ] **Step 3: Implement schemas**

In `messages-host.ts`, add:

```ts
const focusMode = z.enum(['auto', 'pinned'])

const sessionSummary = z.object({
  index: z.number().int().nonnegative(),
  id: z.string().min(1),
  name: z.string().min(1).max(40),
  activity: z.enum(ACTIVITY),
  selected: z.boolean().optional(),
  pinned: z.boolean().optional(),
  auto: z.boolean().optional(),
})
```

Add to `statusPayload`:

```ts
focus: z
  .object({
    mode: focusMode,
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .partial()
  .optional(),
sessions: z.array(sessionSummary).max(8).optional(),
```

In `messages-device.ts`, replace the current enum-only device event schema with a union:

```ts
const legacyDeviceEventPayload = z
  .object({
    kind: z.enum(['battery', 'button', 'shake']),
  })
  .passthrough()

const focusDeviceEventPayload = z.discriminatedUnion('target', [
  z.object({ kind: z.literal('focus'), target: z.literal('auto') }).strict(),
  z.object({ kind: z.literal('focus'), target: z.literal('session'), sessionId: z.string().min(1) }).strict(),
])

export const deviceEventPayload = z.union([legacyDeviceEventPayload, focusDeviceEventPayload])
```

- [ ] **Step 4: Run protocol tests**

Run: `pnpm vitest run packages/protocol/src`

Expected: PASS.

- [ ] **Step 5: Regenerate firmware protocol constants**

Run: `pnpm gen:msgs`

Expected: generated files update only if the generator emits changed schema-derived constants.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/messages-host.ts packages/protocol/src/messages-device.ts packages/protocol/src/*test.ts firmware/lib/m5proto/messages.h
git commit -m "feat(protocol): add multi-session focus metadata"
```

## Task 2: Daemon Hook and Device Focus Routing

**Files:**
- Modify: `packages/daemon/src/hook-server.ts`
- Modify: `packages/daemon/src/router.ts`
- Modify: `packages/daemon/src/main.ts`
- Test: `packages/daemon/src/hook-server.test.ts`
- Test: `packages/daemon/src/router.test.ts`

- [ ] **Step 1: Write failing hook-server test**

Add a test asserting hook events keep session id:

```ts
it('forwards hook event sessionId to the hook handler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm5ct-hook-'))
  const sockPath = join(dir, 'daemon.sock')
  const server = new HookServer(sockPath)
  const seen: Array<{ event: string; sessionId?: string }> = []
  server.setHookEventHandler((event, meta) => seen.push({ event, sessionId: meta.sessionId }))
  await server.listen()
  try {
    await rpc(sockPath, { event: 'Notification', sessionId: 's2' })
    expect(seen).toEqual([{ event: 'Notification', sessionId: 's2' }])
  } finally {
    await server.close()
  }
})
```

- [ ] **Step 2: Write failing router test**

Replace the no-op-only expectation with focus callback coverage:

```ts
it('routes focus device events to the callback', async () => {
  const calls: unknown[] = []
  const r = new Router((focus) => calls.push(focus))
  await r.handleDeviceEvent({
    v: 1,
    k: 'device.event',
    t: 0,
    p: { kind: 'focus', target: 'session', sessionId: 's2' },
  } as never)
  expect(calls).toEqual([{ target: 'session', sessionId: 's2' }])
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `pnpm vitest run packages/daemon/src/hook-server.test.ts packages/daemon/src/router.test.ts`

Expected: TypeScript/test failures because handlers do not expose metadata or focus callbacks.

- [ ] **Step 4: Implement hook metadata**

Change `HookServer` handler type:

```ts
private onHookEvent: ((event: string, meta: { sessionId?: string }) => void) | null = null

setHookEventHandler(fn: (event: string, meta: { sessionId?: string }) => void): void {
  this.onHookEvent = fn
}
```

In `process()`:

```ts
if (typeof ev === 'string') {
  const sessionId = (msg as { sessionId?: unknown }).sessionId
  this.onHookEvent?.(ev, {
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
  })
  sock.end(`${JSON.stringify({ ok: true })}\n`)
  return
}
```

- [ ] **Step 5: Implement router focus callback**

Use this shape in `router.ts`:

```ts
export type FocusRequest =
  | { target: 'auto' }
  | { target: 'session'; sessionId: string }

export class Router {
  constructor(private readonly onFocus?: (focus: FocusRequest) => void | Promise<void>) {}

  async handleDeviceEvent(env: DecodedEnvelope): Promise<void> {
    if (env.k === 'device.event') {
      const p = env.p as { kind?: unknown; target?: unknown; sessionId?: unknown }
      if (p.kind === 'focus') {
        if (p.target === 'auto') {
          await this.onFocus?.({ target: 'auto' })
          return
        }
        if (p.target === 'session' && typeof p.sessionId === 'string') {
          await this.onFocus?.({ target: 'session', sessionId: p.sessionId })
          return
        }
      }
    }
    log.debug('device event', { k: env.k, p: env.p })
  }
}
```

- [ ] **Step 6: Wire main**

After the aggregator is constructed:

```ts
const router = new Router((focus) => void aggregator.setFocus(focus))
```

Move router construction below aggregator.

Change hook wiring:

```ts
server.setHookEventHandler((ev, meta) => void aggregator.ingestHookEvent(ev, meta.sessionId))
```

- [ ] **Step 7: Run daemon routing tests**

Run: `pnpm vitest run packages/daemon/src/hook-server.test.ts packages/daemon/src/router.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/daemon/src/hook-server.ts packages/daemon/src/router.ts packages/daemon/src/main.ts packages/daemon/src/hook-server.test.ts packages/daemon/src/router.test.ts
git commit -m "feat(daemon): route session focus events"
```

## Task 3: Multi-Session Aggregator State

**Files:**
- Modify: `packages/daemon/src/session-aggregator.ts`
- Test: `packages/daemon/src/session-aggregator.test.ts`

- [ ] **Step 1: Write failing multi-session tests**

Add tests:

```ts
it('keeps separate foreground frames per session and emits session metadata', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' }, workspace: { current_dir: '/repo/a' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' }, workspace: { current_dir: '/repo/b' } }, 222, () => 2000)
  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.model.short).toBe('A')
  expect(frame.p.focus).toEqual({ mode: 'auto', index: 1, total: 2 })
  expect(frame.p.sessions.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
    ['auto', 'AUTO'],
    ['s1', 'a'],
    ['s2', 'b'],
  ])
})

it('auto foregrounds earliest needs_attention session', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)
  await agg.ingestHookEvent('Notification', 's2')
  await agg.ingestHookEvent('Notification', 's1')
  expect(sess.send.mock.calls.at(-1)[0].p.model.short).toBe('A')
})

it('pinned mode ignores another session needing attention', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 222, () => 2000)
  await agg.setFocus({ target: 'session', sessionId: 's1' })
  await agg.ingestHookEvent('Notification', 's2')
  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.model.short).toBe('A')
  expect(frame.p.focus.mode).toBe('pinned')
  expect(frame.p.sessions.find((s: { id: string }) => s.id === 's2').activity).toBe('needs_attention')
})

it('ignores hook events without a known session id', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, { enrich: async () => undefined } as never)
  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingestHookEvent('Notification')
  expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run packages/daemon/src/session-aggregator.test.ts`

Expected: failures because only one global session exists.

- [ ] **Step 3: Implement session records and focus APIs**

Refactor `SessionAggregator` around these types:

```ts
type FocusRequest = { target: 'auto' } | { target: 'session'; sessionId: string }
type FocusMode = 'auto' | 'pinned'

interface TrackedSession {
  id: string
  pid?: number
  firstSeenMs: number
  lastActivityMs: number
  idle: boolean
  activity: Activity
  lastFrame: StatusPayload | null
  lastSample: CostSample | null
  burnHistory: number[]
}
```

Add fields:

```ts
private sessions = new Map<string, TrackedSession>()
private order: string[] = []
private focusMode: FocusMode = 'auto'
private pinnedSessionId: string | undefined
private foregroundSessionId: string | undefined
```

Add method:

```ts
async setFocus(req: FocusRequest): Promise<void> {
  if (req.target === 'auto') {
    this.focusMode = 'auto'
    this.pinnedSessionId = undefined
  } else if (this.sessions.has(req.sessionId)) {
    this.focusMode = 'pinned'
    this.pinnedSessionId = req.sessionId
    this.foregroundSessionId = req.sessionId
  }
  await this.pushSelectedFrame()
}
```

- [ ] **Step 4: Refactor ingestion**

Derive stable ids:

```ts
private sessionKey(cc: StatusLineInput, ccPid?: number): string {
  return cc.session_id ?? (typeof ccPid === 'number' ? `pid:${ccPid}` : 'anonymous')
}
```

On `ingest()`, create or update one `TrackedSession`, update only that record's
activity/burn/history, build its full foreground frame, then call `pushSelectedFrame()`.

Use `mapStatusLineInput(cc, nowMs)` exactly as today for per-session detail
fields. Keep git enrichment per incoming session workspace.

- [ ] **Step 5: Implement foreground selection**

Use these rules:

```ts
private selectForeground(): TrackedSession | null {
  this.dropMissingForeground()
  if (this.focusMode === 'pinned' && this.pinnedSessionId) {
    return this.sessions.get(this.pinnedSessionId) ?? null
  }
  const attention = this.order
    .map((id) => this.sessions.get(id))
    .find((s): s is TrackedSession => !!s && !s.idle && s.activity === 'needs_attention')
  if (attention) return attention
  if (this.foregroundSessionId) {
    const current = this.sessions.get(this.foregroundSessionId)
    if (current && !current.idle) return current
  }
  return this.order.map((id) => this.sessions.get(id)).find((s): s is TrackedSession => !!s && !s.idle) ?? null
}
```

- [ ] **Step 6: Implement status metadata builder**

When live session count is at least two, append:

```ts
private decorateFrame(base: StatusPayload, selected: TrackedSession): StatusPayload {
  const live = this.liveSessions()
  if (live.length < 2) return base
  const selectedIndex = live.findIndex((s) => s.id === selected.id) + 1
  return {
    ...base,
    focus: { mode: this.focusMode, index: selectedIndex, total: live.length },
    sessions: [
      { index: 0, id: 'auto', name: 'AUTO', activity: 'working', auto: true, selected: this.focusMode === 'auto' },
      ...live.map((s, i) => ({
        index: i + 1,
        id: s.id,
        name: this.sessionName(s),
        activity: s.activity,
        selected: s.id === selected.id,
        pinned: this.focusMode === 'pinned' && this.pinnedSessionId === s.id,
      })),
    ],
  }
}
```

Implement `sessionName()` from `lastFrame.workspace.worktree`, then basename of
`lastFrame.workspace.dir`, then short id.

- [ ] **Step 7: Refactor liveness**

`checkLiveness()` iterates tracked sessions. For each session:

- if `pid` exists and `pidAlive(pid)` is false, remove it
- if no `pid` and `now - lastActivityMs > NO_PID_TTL_MS`, remove it

If no sessions remain, send one `{ state:'idle' }`.

If pinned session was removed and other sessions remain, clear the pin, set mode
to `auto`, and push a selected frame with a `sessions` list so firmware can open
the picker when it sees the previous pinned id disappeared.

- [ ] **Step 8: Run aggregator tests**

Run: `pnpm vitest run packages/daemon/src/session-aggregator.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/daemon/src/session-aggregator.ts packages/daemon/src/session-aggregator.test.ts
git commit -m "feat(daemon): track multiple claude sessions"
```

## Task 4: Firmware Status Model and Header Metadata

**Files:**
- Modify: `firmware/lib/m5render/status_model.h`
- Modify: `firmware/lib/m5render/status_model.cpp`
- Modify: `firmware/lib/m5render/pages.h`
- Modify: `firmware/lib/m5render/pages.cpp`
- Test: `firmware/test/test_status_model/test_main.cpp`
- Test: `firmware/test/test_pages/test_main.cpp`

- [ ] **Step 1: Write failing parser tests**

Add tests:

```cpp
void test_parse_focus_and_sessions() {
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame(
    "{\"state\":\"active\",\"focus\":{\"mode\":\"pinned\",\"index\":2,\"total\":3},"
    "\"sessions\":["
    "{\"index\":0,\"id\":\"auto\",\"name\":\"AUTO\",\"activity\":\"working\",\"auto\":true},"
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"awaiting_input\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"needs_attention\",\"selected\":true,\"pinned\":true}"
    "]}",
    m));
  TEST_ASSERT_TRUE(m.hasFocus);
  TEST_ASSERT_TRUE(m.focusPinned);
  TEST_ASSERT_EQUAL(2, m.focusIndex);
  TEST_ASSERT_EQUAL(3, m.focusTotal);
  TEST_ASSERT_EQUAL(3, m.sessionN);
  TEST_ASSERT_EQUAL_STRING("repo-b", m.sessions[2].name);
  TEST_ASSERT_TRUE(m.sessions[2].selected);
}
```

- [ ] **Step 2: Write failing page tests**

Add tests:

```cpp
void test_header_shows_focus_label_when_multi_session() {
  StatusModel m;
  m.hasFocus = true; m.focusPinned = false; m.focusIndex = 2; m.focusTotal = 4;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "AUTO 2/4"));
}

void test_header_hides_focus_label_for_single_session() {
  StatusModel m;
  m.hasFocus = true; m.focusTotal = 1;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_FALSE(c.called("text", "AUTO 1/1"));
}

void test_sessions_page_renders_rows() {
  StatusModel m;
  m.sessionN = 2;
  strcpy(m.sessions[0].name, "AUTO");
  m.sessions[0].autoMode = true;
  strcpy(m.sessions[1].name, "repo-a");
  m.sessions[1].activity = Activity::NeedsAttention;
  MockCanvas c; renderPage(PageId::Sessions, m, c);
  TEST_ASSERT_TRUE(c.called("text", "AUTO"));
  TEST_ASSERT_TRUE(c.called("text", "repo-a"));
  TEST_ASSERT_TRUE(c.called("text", "NEEDS YOU"));
}
```

- [ ] **Step 3: Run native tests to verify failure**

Run: `pio test --project-dir firmware -e native -f test_status_model -f test_pages`

Expected: compile failures until fields/page are added.

- [ ] **Step 4: Add model fields**

In `StatusModel`:

```cpp
bool hasFocus = false;
bool focusPinned = false;
int focusIndex = 0;
int focusTotal = 0;

struct SessionSummary {
  int index = 0;
  char id[32] = "";
  char name[40] = "";
  Activity activity = Activity::Working;
  bool selected = false;
  bool pinned = false;
  bool autoMode = false;
};
int sessionN = 0;
SessionSummary sessions[8];
```

- [ ] **Step 5: Parse model fields**

In `parseStatusFrame()`:

```cpp
if (doc["focus"].is<JsonObjectConst>()) {
  JsonObjectConst focus = doc["focus"].as<JsonObjectConst>();
  m.hasFocus = true;
  const char* mode = focus["mode"] | "auto";
  m.focusPinned = strcmp(mode, "pinned") == 0;
  m.focusIndex = focus["index"] | 0;
  m.focusTotal = focus["total"] | 0;
}
if (doc["sessions"].is<JsonArrayConst>()) {
  m.sessionN = 0;
  for (JsonObjectConst item : doc["sessions"].as<JsonArrayConst>()) {
    if (m.sessionN >= 8) break;
    StatusModel::SessionSummary& s = m.sessions[m.sessionN++];
    s.index = item["index"] | 0;
    copyStr(s.id, sizeof(s.id), item["id"] | "");
    copyStr(s.name, sizeof(s.name), item["name"] | "");
    const char* act = item["activity"] | "working";
    if (strcmp(act, "needs_attention") == 0) s.activity = Activity::NeedsAttention;
    else if (strcmp(act, "awaiting_input") == 0) s.activity = Activity::AwaitingInput;
    else s.activity = Activity::Working;
    s.selected = item["selected"] | false;
    s.pinned = item["pinned"] | false;
    s.autoMode = item["auto"] | false;
  }
}
```

- [ ] **Step 6: Add page enum and dynamic page count helpers**

In `pages.h`:

```cpp
enum class PageId : uint8_t { Overview = 0, Cost = 1, Limits = 2, Workspace = 3, Sessions = 4 };
constexpr int kBasePageCount = 4;
constexpr int kMaxPageCount = 5;
bool hasSessionsPage(const StatusModel& m);
int pageCountFor(const StatusModel& m);
```

Implement:

```cpp
bool hasSessionsPage(const StatusModel& m) { return m.sessionN >= 3; } // AUTO + 2 live sessions
int pageCountFor(const StatusModel& m) { return hasSessionsPage(m) ? kMaxPageCount : kBasePageCount; }
```

- [ ] **Step 7: Render focus label and Sessions page**

In `renderHeader()`, after model text and before activity badge:

```cpp
if (m.hasFocus && m.focusTotal >= 2) {
  char f[20];
  snprintf(f, sizeof(f), "%s %d/%d", m.focusPinned ? "PINNED" : "AUTO", m.focusIndex, m.focusTotal);
  c.text(f, 154, 17, Font::Label, Align::MiddleCenter, color::ink2);
}
```

Add `drawSessions()` that renders up to 5 rows starting at y=42, label + activity
at right, selected rows with `color::cardLine` border and pinned rows with
`color::accent`.

Update `renderPage()` switch to include `PageId::Sessions`.

- [ ] **Step 8: Run firmware native parser/page tests**

Run: `pio test --project-dir firmware -e native -f test_status_model -f test_pages`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add firmware/lib/m5render/status_model.* firmware/lib/m5render/pages.* firmware/test/test_status_model/test_main.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): render multi-session metadata"
```

## Task 5: Firmware Picker Input and Focus Event

**Files:**
- Modify: `firmware/lib/m5render/app.h`
- Modify: `firmware/lib/m5render/app.cpp`
- Modify: `firmware/lib/m5proto/m5proto.cpp`
- Modify: `firmware/lib/m5proto/m5proto.h`
- Test: `firmware/test/test_app/test_main.cpp`

- [ ] **Step 1: Write failing app tests**

Add tests that construct an app with a mock board, feed a status frame with
sessions, then use host `tap` RPCs to simulate top-half and bottom-half touch
regions:

```cpp
void test_sessions_page_top_tap_moves_highlight() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":0,\"id\":\"auto\",\"name\":\"AUTO\",\"activity\":\"working\",\"auto\":true},"
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  for (int n = 0; n < 4; ++n) {
    const char* pageTap = "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"p\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
    app.handleLine(pageTap, std::strlen(pageTap));
  }
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
  const char* topTap = "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"m\",\"p\":{\"x\":160,\"y\":20,\"duration_ms\":50}}";
  app.handleLine(topTap, std::strlen(topTap));
  TEST_ASSERT_EQUAL(1, app.pickerIndex());
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Sessions), static_cast<int>(app.page()));
}

void test_sessions_page_bottom_tap_sends_focus_event() {
  MockTransport t; MockCanvas c; m5hal::mock::MockDisplay d; m5hal::mock::MockInput i;
  Board b = makeTouchBoard(t, d, i);
  App app(c, &b); app.setNowFn(mockNow);
  const char* active =
    "{\"v\":1,\"k\":\"status\",\"t\":0,\"p\":{\"state\":\"active\","
    "\"sessions\":["
    "{\"index\":0,\"id\":\"auto\",\"name\":\"AUTO\",\"activity\":\"working\",\"auto\":true},"
    "{\"index\":1,\"id\":\"s1\",\"name\":\"repo-a\",\"activity\":\"working\"},"
    "{\"index\":2,\"id\":\"s2\",\"name\":\"repo-b\",\"activity\":\"working\"}"
    "]}}";
  app.handleLine(active, std::strlen(active));
  for (int n = 0; n < 4; ++n) {
    const char* pageTap = "{\"v\":1,\"k\":\"tap\",\"t\":1,\"id\":\"p\",\"p\":{\"x\":160,\"y\":120,\"duration_ms\":50}}";
    app.handleLine(pageTap, std::strlen(pageTap));
  }
  const char* topTap = "{\"v\":1,\"k\":\"tap\",\"t\":2,\"id\":\"m\",\"p\":{\"x\":160,\"y\":20,\"duration_ms\":50}}";
  app.handleLine(topTap, std::strlen(topTap));
  t.drain_tx();
  const char* bottomTap = "{\"v\":1,\"k\":\"tap\",\"t\":3,\"id\":\"c\",\"p\":{\"x\":160,\"y\":220,\"duration_ms\":50}}";
  app.handleLine(bottomTap, std::strlen(bottomTap));
  const std::string tx = t.drain_tx();
  TEST_ASSERT_TRUE(tx.find("\"k\":\"device.event\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"kind\":\"focus\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"target\":\"session\"") != std::string::npos);
  TEST_ASSERT_TRUE(tx.find("\"sessionId\":\"s1\"") != std::string::npos);
  TEST_ASSERT_EQUAL(static_cast<int>(PageId::Overview), static_cast<int>(app.page()));
}
```

Use existing mock HAL helpers from `firmware/test/test_app`.

- [ ] **Step 2: Run app tests to verify failure**

Run: `pio test --project-dir firmware -e native -f test_app`

Expected: failures because picker input and focus event encoding do not exist.

- [ ] **Step 3: Add focus event encoder**

Add C++ helpers:

```cpp
std::string encode_focus_event_auto(uint64_t t_ms);
std::string encode_focus_event_session(uint64_t t_ms, const char* session_id);
```

Output lines:

```json
{"v":1,"k":"device.event","t":123,"p":{"kind":"focus","target":"auto"}}
{"v":1,"k":"device.event","t":123,"p":{"kind":"focus","target":"session","sessionId":"s1"}}
```

- [ ] **Step 4: Implement dynamic page cycle**

In `App::handleTouchTapAction()`:

```cpp
if (link_ != LinkState::Live) return;
if (page_ == PageId::Sessions && hasSessionsPage(model_)) {
  handleSessionsTap(code, nowMs);
  return;
}
const int count = pageCountFor(model_);
page_ = static_cast<PageId>((static_cast<int>(page_) + 1) % count);
dirty_ = true;
```

Pass `InputEvent.code` into `handleTouchTapAction`.

- [ ] **Step 5: Implement Sessions page local highlight**

Add to `App`:

```cpp
int pickerIndex_ = 0;
```

On every parsed status frame, clamp:

```cpp
if (pickerIndex_ >= model_.sessionN) pickerIndex_ = 0;
```

Implement:

```cpp
void App::handleSessionsTap(uint16_t code, uint32_t t_ms) {
  if (code == 0) {
    pickerIndex_ = model_.sessionN > 0 ? (pickerIndex_ + 1) % model_.sessionN : 0;
    dirty_ = true;
    return;
  }
  if (model_.sessionN <= 0) return;
  const auto& s = model_.sessions[pickerIndex_];
  std::string line = s.autoMode
    ? m5proto::encode_focus_event_auto(t_ms)
    : m5proto::encode_focus_event_session(t_ms, s.id);
  send(line.c_str(), line.size());
  page_ = PageId::Overview;
  dirty_ = true;
}
```

Update `drawSessions()` to use `m.pickerIndex` or pass picker index as a render
parameter. If keeping `renderPage(PageId, StatusModel, Canvas&)` unchanged, store
`pickerIndex` in `StatusModel` as a firmware-local field that is never parsed from
wire.

- [ ] **Step 6: Run app tests**

Run: `pio test --project-dir firmware -e native -f test_app`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add firmware/lib/m5render/app.* firmware/lib/m5proto/m5proto.* firmware/test/test_app/test_main.cpp
git commit -m "feat(firmware): support session picker input"
```

## Task 6: Integration and Compatibility

**Files:**
- Modify: `packages/daemon/src/e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add e2e tests**

Add daemon-level tests with the existing fake-firmware harness:

```ts
it('keeps pinned foreground when another session needs attention', async () => {
  const h = await startHarness()
  try {
    await h.sendHook({ statusLine: { session_id: 's1', model: { display_name: 'A' } }, ccPid: 111 })
    await h.sendHook({ statusLine: { session_id: 's2', model: { display_name: 'B' } }, ccPid: 222 })
    await h.deviceEvent({ kind: 'focus', target: 'session', sessionId: 's1' })
    await h.sendHook({ event: 'Notification', sessionId: 's2' })
    const frame = h.lastStatus()
    expect(frame.p.model.short).toBe('A')
    expect(frame.p.sessions.find((s: { id: string }) => s.id === 's2').activity).toBe('needs_attention')
  } finally {
    await h.stop()
  }
})

it('auto foregrounds earliest needs_attention session', async () => {
  const h = await startHarness()
  try {
    await h.sendHook({ statusLine: { session_id: 's1', model: { display_name: 'A' } }, ccPid: 111 })
    await h.sendHook({ statusLine: { session_id: 's2', model: { display_name: 'B' } }, ccPid: 222 })
    await h.sendHook({ event: 'Notification', sessionId: 's2' })
    await h.sendHook({ event: 'Notification', sessionId: 's1' })
    expect(h.lastStatus().p.model.short).toBe('A')
  } finally {
    await h.stop()
  }
})
```

- [ ] **Step 2: Run e2e tests to verify behavior**

Run: `pnpm vitest run packages/daemon/src/e2e.test.ts`

Expected: PASS after previous tasks.

- [ ] **Step 3: Run full TypeScript checks**

Run: `pnpm test`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run firmware tests**

Run: `pio test --project-dir firmware -e native`

Expected: PASS.

- [ ] **Step 5: Run generated-message check**

Run: `pnpm gen:msgs:check`

Expected: PASS, no generated-message drift.

- [ ] **Step 6: Commit final integration changes**

```bash
git add packages/daemon/src/e2e.test.ts README.md
git commit -m "test: cover multi-session focus flow"
```

---

## Self-Review Notes

- Spec coverage: tasks cover protocol additions, hook session ids, device focus events, daemon registry/Auto/Pinned rules, session naming, cost label semantics, firmware parser/header/picker, and tests.
- Scope intentionally excludes CLI pin/auto, history, dashboard aggregation, workspace priority, automatic picker jump, and pinned detail-page banners.
- The plan resolves the HAL input constraint by using top-half next and bottom-half commit on the Sessions page.
