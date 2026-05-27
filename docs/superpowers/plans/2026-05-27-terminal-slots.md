# Terminal Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change multi-Claude identity from Claude conversation `session_id` to live Claude Code terminal/process slots.

**Architecture:** The daemon will track `TerminalSlot` records keyed by `pid:<ccPid>` when a PID is available, with `sid:<session_id>` and `anonymous` as short-lived fallbacks. Claude `session_id` becomes an alias for hook routing only. Firmware keeps the same protocol fields but labels the picker `TERMINALS`.

**Tech Stack:** TypeScript daemon/CLI, Vitest, C++ firmware renderer tests, PlatformIO native tests.

---

### Task 1: Host TerminalSlot Identity

**Files:**
- Modify: `packages/daemon/src/session-aggregator.ts`
- Test: `packages/daemon/src/session-aggregator.test.ts`

- [ ] **Step 1: Add failing unit tests**

Add tests that prove:

```ts
it('updates one terminal slot when the same pid changes session id', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, {
    enrich: async () => undefined,
  } as never)

  await agg.ingest(
    { session_id: 's1', workspace: { current_dir: '/repo/pm' }, model: { display_name: 'A' } },
    83876,
    () => 1000,
  )
  await agg.ingest(
    { session_id: 's2', workspace: { current_dir: '/repo/pm' }, model: { display_name: 'B' } },
    83876,
    () => 2000,
  )
  await agg.ingest(
    { session_id: 'other', workspace: { current_dir: '/repo/m5toys' }, model: { display_name: 'C' } },
    34930,
    () => 3000,
  )

  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.focus).toEqual({ mode: 'auto', index: 1, total: 2 })
  expect(frame.p.sessions.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
    ['auto', 'AUTO'],
    ['pid:83876', 'pm'],
    ['pid:34930', 'm5toys'],
  ])
})
```

Also add tests for alias hook routing and duplicate display names:

```ts
it('routes hook events through old and new session aliases for one terminal slot', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, {
    enrich: async () => undefined,
  } as never)

  await agg.ingest({ session_id: 's1', model: { display_name: 'A' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', model: { display_name: 'B' } }, 111, () => 2000)

  await agg.ingestHookEvent('Notification', 's1')
  expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('needs_attention')

  await agg.ingestHookEvent('UserPromptSubmit', 's2')
  expect(sess.send.mock.calls.at(-1)[0].p.activity).toBe('working')
})

it('disambiguates duplicate terminal names', async () => {
  const sess = fakeSession()
  const agg = new SessionAggregator(() => sess as never, {
    enrich: async () => undefined,
  } as never)

  await agg.ingest({ session_id: 's1', workspace: { current_dir: '/a/pm' } }, 111, () => 1000)
  await agg.ingest({ session_id: 's2', workspace: { current_dir: '/b/pm' } }, 222, () => 2000)

  const frame = sess.send.mock.calls.at(-1)[0]
  expect(frame.p.sessions.map((s: { name: string }) => s.name)).toEqual(['AUTO', 'pm', 'pm #2'])
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @m5stack-coding-toys/daemon test -- session-aggregator.test.ts
```

Expected: tests fail because current code keys records by `session_id`.

- [ ] **Step 3: Implement TerminalSlot model**

In `session-aggregator.ts`:

- rename `TrackedSession` to `TerminalSlot`
- replace `sessions` with `slots`
- add `sessionAliases = new Map<string, string>()`
- make `slotKey(cc, ccPid)` return `pid:<ccPid>`, `sid:<session_id>`, or `anonymous`
- store `currentSessionId` and `knownSessionIds`
- update hook routing to resolve aliases
- keep focus and order based on slot id
- disambiguate duplicate row names in `decorateFrame`

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm --filter @m5stack-coding-toys/daemon test -- session-aggregator.test.ts
```

Expected: all aggregator tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/session-aggregator.ts packages/daemon/src/session-aggregator.test.ts
git commit -m "fix(daemon): key live entries by terminal slot"
```

### Task 2: E2E Regression

**Files:**
- Test: `packages/daemon/src/e2e.test.ts`

- [ ] **Step 1: Add failing e2e test**

Add a test that sends two statusLine frames with the same `ccPid` and different `session_id`, then another `ccPid`, and asserts the fake firmware sees only two terminal rows.

- [ ] **Step 2: Run e2e test**

Run:

```bash
pnpm --filter @m5stack-coding-toys/daemon test -- e2e.test.ts
```

Expected: pass after Task 1.

- [ ] **Step 3: Commit**

```bash
git add packages/daemon/src/e2e.test.ts
git commit -m "test(daemon): cover terminal slot identity"
```

### Task 3: Firmware Picker Label

**Files:**
- Modify: `firmware/lib/m5render/pages.cpp`
- Test: firmware native test files under `firmware/test/native`

- [ ] **Step 1: Locate existing Sessions title tests or renderer output**

Use:

```bash
rg "SESSIONS|Sessions|sessions" firmware -n
```

- [ ] **Step 2: Update tests first if title is asserted**

Change expected picker title from `SESSIONS` to `TERMINALS`.

- [ ] **Step 3: Update renderer title**

Change the Sessions page title string from `SESSIONS` to `TERMINALS`.

- [ ] **Step 4: Run firmware native tests**

Run:

```bash
pio test --project-dir firmware -e native
```

Expected: native firmware tests pass.

- [ ] **Step 5: Commit**

```bash
git add firmware
git commit -m "fix(firmware): label picker as terminals"
```

### Task 4: Build, Format, Restart

**Files:**
- Generated dist only, not committed unless repo policy tracks it.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm gen:msgs:check && pio test --project-dir firmware -e native && pnpm lint
```

- [ ] **Step 2: Rebuild linked CLI**

Run:

```bash
pnpm --filter m5ct build
```

- [ ] **Step 3: Restart daemon through the real statusline bootstrap path**

Run:

```bash
pkill -f 'node .*m5ctd' || true
rm -f ~/.m5stack-coding-toys/daemon.sock ~/.m5stack-coding-toys/daemon.pid
printf '{}' | m5ct-statusline --event Notification
sleep 2
m5ct status --json
```

Expected: daemon is running from the current worktree and reports `Connected`.

- [ ] **Step 4: Verify hardware state**

Run:

```bash
m5ct screenshot
```

Expected: picker title is `TERMINALS`, and live rows match local `claude` CLI process count.
