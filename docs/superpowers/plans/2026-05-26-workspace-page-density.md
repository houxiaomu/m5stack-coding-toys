# Workspace Page Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the firmware Workspace page body so it shows a dense workspace snapshot plus current git diff details.

**Architecture:** Extend the host protocol with optional `git.diff` data, compute that diff summary in the daemon's existing `GitEnricher`, parse it into the firmware `StatusModel`, then update only the Workspace page renderer. The shared header, page routing, and liveness state machine remain unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, C++ firmware renderer, ArduinoJson, Unity/PlatformIO native tests.

---

## File Structure

- Modify `packages/protocol/src/messages-host.ts`: add optional `git.diff` schema.
- Modify `packages/protocol/src/messages-host.test.ts`: cover valid diff payloads and compatibility without diff.
- Modify `packages/daemon/src/git-enrich.ts`: compute staged + unstaged `--numstat`, merge by path, sort top files, attach `git.diff`.
- Modify `packages/daemon/src/git-enrich.test.ts`: cover text diffs, duplicate paths, binary rows, and top-file cap.
- Modify `firmware/lib/m5render/status_model.h`: add diff summary fields and three top-file slots.
- Modify `firmware/lib/m5render/status_model.cpp`: parse optional `git.diff`.
- Modify `firmware/test/test_status_model/test_main.cpp`: cover parsing and capping top files.
- Modify `firmware/lib/m5render/pages.cpp`: replace Workspace page body layout.
- Modify `firmware/test/test_pages/test_main.cpp`: cover clean, dirty, and no-git render fallbacks.

## Task 1: Protocol Schema

**Files:**
- Modify: `packages/protocol/src/messages-host.ts`
- Modify: `packages/protocol/src/messages-host.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Add tests that show the desired schema shape:

```ts
it('accepts git diff summary fields', () => {
  const parsed = statusPayload.parse({
    state: 'active',
    git: {
      branch: 'feat/workspace-ui',
      diff: {
        filesChanged: 4,
        linesAdded: 128,
        linesRemoved: 24,
        topFiles: [
          { path: 'firmware/lib/m5render/pages.cpp', added: 84, removed: 12 },
          { path: 'firmware/lib/m5render/status_model.h', added: 18, removed: 0 },
        ],
      },
    },
  })
  expect(parsed.git?.diff?.topFiles?.[0]?.path).toBe('firmware/lib/m5render/pages.cpp')
})

it('keeps git diff optional for older daemons', () => {
  expect(
    statusPayload.safeParse({
      state: 'active',
      git: { branch: 'main', staged: 0, unstaged: 0, untracked: 0 },
    }).success,
  ).toBe(true)
})
```

- [ ] **Step 2: Run protocol test and verify red**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts
```

Expected: the new diff test fails because `git.diff` is not in the schema.

- [ ] **Step 3: Add schema fields**

Add a `gitDiffPayload` or inline `diff` object under `statusPayload.git`:

```ts
diff: z
  .object({
    filesChanged: nonNegInt,
    linesAdded: nonNegInt,
    linesRemoved: nonNegInt,
    topFiles: z
      .array(
        z.object({
          path: z.string(),
          added: nonNegInt,
          removed: nonNegInt,
        }),
      )
      .max(3),
  })
  .partial(),
```

Keep `git.diff` optional by making the enclosing `diff` property optional.

- [ ] **Step 4: Verify protocol test green**

Run:

```bash
pnpm vitest run packages/protocol/src/messages-host.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/messages-host.ts packages/protocol/src/messages-host.test.ts
git commit -m "feat(protocol): add workspace diff status fields"
```

## Task 2: Daemon Git Diff Enrichment

**Files:**
- Modify: `packages/daemon/src/git-enrich.ts`
- Modify: `packages/daemon/src/git-enrich.test.ts`

- [ ] **Step 1: Write failing daemon tests**

Add tests using the existing fake runner pattern:

```ts
it('computes merged staged and unstaged diff stats', async () => {
  const run = fakeRunner({
    'rev-parse --abbrev-ref HEAD': 'feat/workspace-ui\n',
    'status --porcelain': ' M firmware/lib/m5render/pages.cpp\nA  firmware/lib/m5render/status_model.h\n?? scratch.txt\n',
    'rev-list --left-right --count @{upstream}...HEAD': '0\t2\n',
    'log -1 --format=%h%x1f%s%x1f%ct': 'abc1234\x1fwork\x1f1000\n',
    'diff --numstat': '84\t12\tfirmware/lib/m5render/pages.cpp\n-\t-\tfirmware/assets/logo.png\n',
    'diff --cached --numstat': '18\t0\tfirmware/lib/m5render/status_model.h\n4\t2\tfirmware/lib/m5render/pages.cpp\n',
  })

  const out = await new GitEnricher(run).enrich('/repo', 1000_000)

  expect(out?.diff).toMatchObject({
    filesChanged: 3,
    linesAdded: 106,
    linesRemoved: 14,
  })
  expect(out?.diff?.topFiles).toEqual([
    { path: 'firmware/lib/m5render/pages.cpp', added: 88, removed: 14 },
    { path: 'firmware/lib/m5render/status_model.h', added: 18, removed: 0 },
    { path: 'firmware/assets/logo.png', added: 0, removed: 0 },
  ])
})

it('caps diff top files at three by line churn', async () => {
  const run = fakeRunner({
    'rev-parse --abbrev-ref HEAD': 'main\n',
    'status --porcelain': ' M a\n M b\n M c\n M d\n',
    'diff --numstat': '1\t0\ta\n20\t0\tb\n3\t4\tc\n9\t9\td\n',
    'diff --cached --numstat': '',
  })

  const out = await new GitEnricher(run).enrich('/repo', 0)

  expect(out?.diff?.topFiles).toEqual([
    { path: 'b', added: 20, removed: 0 },
    { path: 'd', added: 9, removed: 9 },
    { path: 'c', added: 3, removed: 4 },
  ])
})
```

Also update the existing cache test's expected command count from 4 to 6 after
diff commands are added:

```ts
expect(run.mock.calls.length).toBe(6)
```

- [ ] **Step 2: Run daemon test and verify red**

Run:

```bash
pnpm vitest run packages/daemon/src/git-enrich.test.ts
```

Expected: new assertions fail because `diff` is not computed.

- [ ] **Step 3: Implement diff parsing helper**

Add a helper in `git-enrich.ts`:

```ts
function parseNumstat(out: string): Array<{ path: string; added: number; removed: number }> {
  const rows: Array<{ path: string; added: number; removed: number }> = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [a, r, ...pathParts] = line.split('\t')
    const path = pathParts.join('\t')
    if (!path) continue
    rows.push({
      path,
      added: a === '-' ? 0 : Number.parseInt(a, 10) || 0,
      removed: r === '-' ? 0 : Number.parseInt(r, 10) || 0,
    })
  }
  return rows
}
```

- [ ] **Step 4: Implement diff summary helper**

Add:

```ts
function summarizeDiff(rows: Array<{ path: string; added: number; removed: number }>): GitFields['diff'] {
  const byPath = new Map<string, { path: string; added: number; removed: number }>()
  for (const row of rows) {
    const cur = byPath.get(row.path) ?? { path: row.path, added: 0, removed: 0 }
    cur.added += row.added
    cur.removed += row.removed
    byPath.set(row.path, cur)
  }
  const merged = [...byPath.values()]
  merged.sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))
  return {
    filesChanged: merged.length,
    linesAdded: merged.reduce((sum, row) => sum + row.added, 0),
    linesRemoved: merged.reduce((sum, row) => sum + row.removed, 0),
    topFiles: merged.slice(0, 3),
  }
}
```

- [ ] **Step 5: Wire helpers into `GitEnricher.enrich()`**

After status parsing, run:

```ts
try {
  const unstagedDiff = await this.run(['diff', '--numstat'], dir)
  const stagedDiff = await this.run(['diff', '--cached', '--numstat'], dir)
  fields.diff = summarizeDiff([...parseNumstat(unstagedDiff), ...parseNumstat(stagedDiff)])
} catch {
  // diff stats are optional; keep the rest of git enrichment
}
```

- [ ] **Step 6: Verify daemon test green**

Run:

```bash
pnpm vitest run packages/daemon/src/git-enrich.test.ts
```

Expected: all tests in the file pass.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/git-enrich.ts packages/daemon/src/git-enrich.test.ts
git commit -m "feat(daemon): enrich workspace diff summary"
```

## Task 3: Firmware Status Model

**Files:**
- Modify: `firmware/lib/m5render/status_model.h`
- Modify: `firmware/lib/m5render/status_model.cpp`
- Modify: `firmware/test/test_status_model/test_main.cpp`

- [ ] **Step 1: Write failing firmware model tests**

Add a test that parses `git.diff`:

```cpp
void test_git_diff_populates_workspace_summary() {
  StatusModel m;
  const char* s =
    "{\"state\":\"active\",\"git\":{\"branch\":\"feat/x\",\"staged\":2,\"unstaged\":5,\"untracked\":1,"
    "\"diff\":{\"filesChanged\":4,\"linesAdded\":128,\"linesRemoved\":24,"
    "\"topFiles\":["
    "{\"path\":\"firmware/lib/m5render/pages.cpp\",\"added\":84,\"removed\":12},"
    "{\"path\":\"firmware/lib/m5render/status_model.h\",\"added\":18,\"removed\":0},"
    "{\"path\":\"packages/daemon/src/git-enrich.ts\",\"added\":26,\"removed\":12},"
    "{\"path\":\"extra.cpp\",\"added\":99,\"removed\":99}]}}}";

  TEST_ASSERT_TRUE(parseStatusFrame(s, m));
  TEST_ASSERT_TRUE(m.hasDiff);
  TEST_ASSERT_EQUAL(4, m.diffFilesChanged);
  TEST_ASSERT_EQUAL(128, m.diffLinesAdded);
  TEST_ASSERT_EQUAL(24, m.diffLinesRemoved);
  TEST_ASSERT_EQUAL(3, m.topFileN);
  TEST_ASSERT_EQUAL_STRING("firmware/lib/m5render/pages.cpp", m.topFiles[0].path);
  TEST_ASSERT_EQUAL(84, m.topFiles[0].added);
  TEST_ASSERT_EQUAL(12, m.topFiles[0].removed);
}
```

- [ ] **Step 2: Register and run model test red**

Add `RUN_TEST(test_git_diff_populates_workspace_summary);`, then run:

```bash
pio test --project-dir firmware -e native -f test_status_model
```

Expected: compilation fails because diff fields do not exist.

- [ ] **Step 3: Add firmware model fields**

In `StatusModel`, add:

```cpp
bool hasDiff = false;
int diffFilesChanged = 0, diffLinesAdded = 0, diffLinesRemoved = 0;
struct TopFile {
  char path[40] = "";
  int added = 0;
  int removed = 0;
};
int topFileN = 0;
TopFile topFiles[3];
```

- [ ] **Step 4: Parse `git.diff`**

Inside the existing `git` parse block, add:

```cpp
if (doc["git"]["diff"].is<JsonObjectConst>()) {
  JsonObjectConst diff = doc["git"]["diff"].as<JsonObjectConst>();
  m.hasDiff = true;
  m.diffFilesChanged = diff["filesChanged"] | 0;
  m.diffLinesAdded = diff["linesAdded"] | 0;
  m.diffLinesRemoved = diff["linesRemoved"] | 0;
  m.topFileN = 0;
  if (diff["topFiles"].is<JsonArrayConst>()) {
    for (JsonVariantConst v : diff["topFiles"].as<JsonArrayConst>()) {
      if (m.topFileN >= 3) break;
      copyStr(m.topFiles[m.topFileN].path, sizeof(m.topFiles[m.topFileN].path), v["path"] | "");
      m.topFiles[m.topFileN].added = v["added"] | 0;
      m.topFiles[m.topFileN].removed = v["removed"] | 0;
      ++m.topFileN;
    }
  }
}
```

- [ ] **Step 5: Verify model test green**

Run:

```bash
pio test --project-dir firmware -e native -f test_status_model
```

Expected: all status model tests pass.

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/m5render/status_model.h firmware/lib/m5render/status_model.cpp firmware/test/test_status_model/test_main.cpp
git commit -m "feat(firmware): parse workspace diff status"
```

## Task 4: Workspace Page Rendering

**Files:**
- Modify: `firmware/lib/m5render/pages.cpp`
- Modify: `firmware/test/test_pages/test_main.cpp`

- [ ] **Step 1: Write failing page tests**

Add clean and dirty render tests:

```cpp
void test_workspace_dirty_renders_diff_summary_and_top_files() {
  StatusModel m;
  m.hasGit = true;
  strcpy(m.branch, "feat/workspace-ui");
  m.ahead = 2;
  m.staged = 2;
  m.unstaged = 5;
  m.untracked = 1;
  strcpy(m.wsDir, "/Users/houxiaomu/playground/m5toys");
  m.hasDiff = true;
  m.diffFilesChanged = 4;
  m.diffLinesAdded = 128;
  m.diffLinesRemoved = 24;
  m.topFileN = 2;
  strcpy(m.topFiles[0].path, "firmware/lib/m5render/pages.cpp");
  m.topFiles[0].added = 84;
  m.topFiles[0].removed = 12;
  strcpy(m.topFiles[1].path, "packages/daemon/src/git-enrich.ts");
  m.topFiles[1].added = 26;
  m.topFiles[1].removed = 12;

  MockCanvas c;
  renderPage(PageId::Workspace, m, c);

  TEST_ASSERT_TRUE(c.called("text", "dirty"));
  TEST_ASSERT_TRUE(c.called("text", "Files"));
  TEST_ASSERT_TRUE(c.called("text", "2 staged   5 modified   1 new"));
  TEST_ASSERT_TRUE(c.called("text", "Lines"));
  TEST_ASSERT_TRUE(c.called("text", "+128       -24"));
  TEST_ASSERT_TRUE(c.called("text", "Top"));
  TEST_ASSERT_TRUE(c.called("text", "pages.cpp"));
}

void test_workspace_clean_renders_commit_context() {
  StatusModel m;
  m.hasGit = true;
  strcpy(m.branch, "main");
  strcpy(m.wsDir, "/Users/houxiaomu/playground/m5toys");
  strcpy(m.lastCommitHash, "2314b8b");
  strcpy(m.lastCommitMsg, "Merge fix/screenshot-host-encode");
  m.lastCommitMins = 12;

  MockCanvas c;
  renderPage(PageId::Workspace, m, c);

  TEST_ASSERT_TRUE(c.called("text", "clean"));
  TEST_ASSERT_TRUE(c.called("text", "Status"));
  TEST_ASSERT_TRUE(c.called("text", "no local changes"));
  TEST_ASSERT_TRUE(c.called("text", "12m"));
  TEST_ASSERT_TRUE(c.called("text", "2314b8b"));
}
```

- [ ] **Step 2: Register and run page tests red**

Add both `RUN_TEST` calls, then run:

```bash
pio test --project-dir firmware -e native -f test_pages
```

Expected: tests fail because old Workspace layout does not render the new labels and states.

- [ ] **Step 3: Add small formatting helpers in `pages.cpp`**

Add local helpers near the existing page helpers:

```cpp
static const char* basenamePtr(const char* path) {
  if (!path || !*path) return kDash;
  const char* last = path;
  for (const char* p = path; *p; ++p) if (*p == '/') last = p + 1;
  return *last ? last : path;
}

static const char* tailPath(const char* path, int segments, char* out, size_t cap) {
  if (!path || !*path) {
    snprintf(out, cap, "%s", kDash);
    return out;
  }
  const char* start = path + strlen(path);
  int seen = 0;
  while (start > path) {
    --start;
    if (*start == '/' && ++seen >= segments) {
      ++start;
      break;
    }
  }
  snprintf(out, cap, "/%s", start);
  return out;
}

static const char* shortFile(const char* path) {
  return basenamePtr(path);
}
```

Include `<cstring>` if needed.

- [ ] **Step 4: Replace Workspace body renderer**

Keep no-git fallback, then render:

```cpp
const bool dirty = (m.staged + m.unstaged + m.untracked) > 0;
c.text(m.branch[0] ? m.branch : kDash, 10, 42, Font::Title, Align::TopLeft, color::ink);
c.text(dirty ? "dirty" : "clean", 230, 44, Font::Label, Align::TopRight,
       dirty ? color::warn : color::good);

char ab[24];
snprintf(ab, sizeof(ab), "^%d v%d", m.ahead, m.behind);
c.text(ab, 310, 44, Font::Label, Align::TopRight, m.behind > 0 ? color::warn : color::mute);

char pathHint[32];
c.text(basenamePtr(m.wsDir), 10, 62, Font::Label, Align::TopLeft, color::ink2);
c.text(tailPath(m.wsDir, 2, pathHint, sizeof(pathHint)), 310, 62, Font::Label, Align::TopRight, color::mute);
c.drawHLine(10, 80, 300, color::hairline);

char files[48];
snprintf(files, sizeof(files), "%d staged   %d modified   %d new", m.staged, m.unstaged, m.untracked);
c.text("Files", 10, 92, Font::Label, Align::TopLeft, color::mute);
c.text(files, 310, 92, Font::Label, Align::TopRight, color::ink);

char lines[32];
snprintf(lines, sizeof(lines), "+%d       -%d",
         m.hasDiff ? m.diffLinesAdded : m.linesAdded,
         m.hasDiff ? m.diffLinesRemoved : m.linesRemoved);
c.text("Lines", 10, 112, Font::Label, Align::TopLeft, color::mute);
c.text(lines, 310, 112, Font::Label, Align::TopRight, color::ink);
```

For dirty detail:

```cpp
if (dirty) {
  c.text("Top", 10, 132, Font::Label, Align::TopLeft, color::mute);
  if (m.topFileN == 0) {
    c.text("uncommitted changes", 310, 132, Font::Label, Align::TopRight, color::ink);
  } else {
    for (int i = 0; i < m.topFileN; ++i) {
      char churn[20];
      snprintf(churn, sizeof(churn), "+%d / -%d", m.topFiles[i].added, m.topFiles[i].removed);
      int y = 132 + i * 22;
      c.text(i == 0 ? "Top" : "", 10, y, Font::Label, Align::TopLeft, color::mute);
      c.text(shortFile(m.topFiles[i].path), 70, y, Font::Label, Align::TopLeft, color::ink);
      c.text(churn, 310, y, Font::Label, Align::TopRight, color::ink2);
    }
  }
}
```

For clean detail:

```cpp
else {
  c.text("Status", 10, 132, Font::Label, Align::TopLeft, color::mute);
  c.text("no local changes", 310, 132, Font::Label, Align::TopRight, color::ink);
  if (m.lastCommitHash[0]) {
    char age[12];
    if (m.lastCommitMins >= 60)
      snprintf(age, sizeof(age), "%dh", m.lastCommitMins / 60);
    else
      snprintf(age, sizeof(age), "%dm", m.lastCommitMins);
    c.text(age, 10, 176, Font::Mono, Align::TopLeft, color::mute);
    c.text(m.lastCommitHash, 58, 176, Font::Mono, Align::TopLeft, color::mute);
    c.text(m.lastCommitMsg, 115, 176, Font::Label, Align::TopLeft, color::ink);
  }
}
```

- [ ] **Step 5: Verify page test green**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
```

Expected: all page tests pass.

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/m5render/pages.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): densify workspace page"
```

## Task 5: Full Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run TypeScript verification**

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm gen:msgs:check
```

Expected: all commands pass.

- [ ] **Step 2: Run firmware verification**

```bash
pnpm fw:test
```

Expected: all native firmware tests pass.

- [ ] **Step 3: Inspect final diff**

```bash
git status --short
git log --oneline --decorate -5
git diff --stat main...HEAD
```

Expected: source and tests changed only in files listed in this plan, with multiple focused commits.
