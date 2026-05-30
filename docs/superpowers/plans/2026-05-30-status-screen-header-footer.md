# Status Screen Header/Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the model out of the Live header, show the current terminal name in data-page headers, label the picker `TERMINALS`, and add a persistent date/page/time footer.

**Architecture:** Keep the change inside firmware rendering. `App` refreshes `DeviceInfo` before Live rendering, `renderPage` receives it, and shared helpers derive the header title and footer from existing `StatusModel` and `DeviceInfo` fields. No host protocol or daemon changes are required.

**Tech Stack:** C++ firmware renderer, M5 render HAL `Canvas`, Unity native tests, PlatformIO, existing pnpm/Biome workspace checks.

---

### Task 1: Lock Header, Overview, And Footer Expectations

**Files:**
- Modify: `firmware/test/test_pages/test_main.cpp`
- Read: `firmware/lib/mock_hal/mock_canvas.h`
- Read: `firmware/lib/m5render/pages.h`

- [ ] **Step 1: Add DeviceInfo fixtures and failing page tests**

Add these helpers near the top of `firmware/test/test_pages/test_main.cpp` after `using namespace m5render;`:

```cpp
static DeviceInfo testDevice() {
  DeviceInfo d;
  strcpy(d.date, "2026-05-30");
  strcpy(d.clock, "18:14");
  d.batteryPct = 78;
  return d;
}
```

Update existing `renderPage(...)` test calls as needed after Task 2 changes the signature. For the new tests, add:

```cpp
void test_header_uses_selected_terminal_name_not_model() {
  StatusModel m;
  strcpy(m.modelShort, "Opus 4.8");
  m.sessionN = 2;
  strcpy(m.sessions[0].name, "AUTO");
  m.sessions[0].autoMode = true;
  strcpy(m.sessions[1].name, "fullfs");
  m.sessions[1].selected = true;
  MockCanvas c;
  renderHeader(PageId::Overview, m, c);
  TEST_ASSERT_TRUE(c.called("text", "fullfs"));
  TEST_ASSERT_FALSE(c.called("text", "Opus 4.8"));
}

void test_header_falls_back_to_worktree_name() {
  StatusModel m;
  strcpy(m.modelShort, "Opus 4.8");
  strcpy(m.wsWorktree, "m5toys");
  MockCanvas c;
  renderHeader(PageId::Cost, m, c);
  TEST_ASSERT_TRUE(c.called("text", "m5toys"));
  TEST_ASSERT_FALSE(c.called("text", "Opus 4.8"));
}

void test_sessions_header_is_terminals() {
  StatusModel m;
  strcpy(m.modelShort, "Opus 4.8");
  strcpy(m.wsWorktree, "m5toys");
  MockCanvas c;
  renderHeader(PageId::Sessions, m, c);
  TEST_ASSERT_TRUE(c.called("text", "TERMINALS"));
  TEST_ASSERT_FALSE(c.called("text", "Opus 4.8"));
}

void test_overview_context_label_includes_model() {
  StatusModel m;
  m.hasContext = true;
  m.ctxUsedPct = 47;
  strcpy(m.modelShort, "Opus 4.8");
  MockCanvas c;
  renderPage(PageId::Overview, m, testDevice(), c);
  TEST_ASSERT_TRUE(c.called("text", "CONTEXT / Opus 4.8"));
}

void test_overview_context_label_omits_missing_model() {
  StatusModel m;
  m.hasContext = true;
  m.ctxUsedPct = 47;
  MockCanvas c;
  renderPage(PageId::Overview, m, testDevice(), c);
  TEST_ASSERT_TRUE(c.called("text", "CONTEXT"));
  TEST_ASSERT_FALSE(c.called("text", "CONTEXT / "));
}

void test_live_footer_renders_date_time_and_page_dots() {
  StatusModel m;
  MockCanvas c;
  renderPage(PageId::Overview, m, testDevice(), c);
  TEST_ASSERT_TRUE(c.called("text", "2026-05-30"));
  TEST_ASSERT_TRUE(c.called("text", "18:14"));
  TEST_ASSERT_TRUE(c.countPrefix("fillCircle") >= kPageCount + 1);
}

void test_live_footer_uses_five_dots_when_sessions_page_exists() {
  StatusModel m;
  m.sessionN = 3;
  MockCanvas c;
  renderPage(PageId::Sessions, m, testDevice(), c);
  TEST_ASSERT_TRUE(c.countPrefix("fillCircle") >= kMaxPageCount + 1);
}
```

Register the new tests in `setup()` after the existing header/page-dot tests:

```cpp
  RUN_TEST(test_header_uses_selected_terminal_name_not_model);
  RUN_TEST(test_header_falls_back_to_worktree_name);
  RUN_TEST(test_sessions_header_is_terminals);
  RUN_TEST(test_overview_context_label_includes_model);
  RUN_TEST(test_overview_context_label_omits_missing_model);
  RUN_TEST(test_live_footer_renders_date_time_and_page_dots);
  RUN_TEST(test_live_footer_uses_five_dots_when_sessions_page_exists);
```

- [ ] **Step 2: Run native page tests and verify RED**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
```

Expected: compile/test failure because `renderHeader(PageId, ...)` and `renderPage(PageId, ..., DeviceInfo, ...)` do not exist yet, and the current header still renders `modelShort`.

- [ ] **Step 3: Commit tests**

```bash
git add firmware/test/test_pages/test_main.cpp
git commit -m "test(firmware): cover status screen header footer"
```

### Task 2: Implement Header Title And Footer Helpers

**Files:**
- Modify: `firmware/lib/m5render/pages.h`
- Modify: `firmware/lib/m5render/pages.cpp`
- Modify: `firmware/test/test_pages/test_main.cpp`

- [ ] **Step 1: Update renderer declarations**

In `firmware/lib/m5render/pages.h`, change the renderer declarations to:

```cpp
void renderPage(PageId id, const StatusModel& m, const DeviceInfo& d, Canvas& c);
void renderWaiting(const DeviceInfo& d, bool linked, Canvas& c);
void renderHeader(PageId id, const StatusModel& m, Canvas& c);
void renderPageDots(PageId active, int total, Canvas& c);
void renderFooter(PageId active, int total, const DeviceInfo& d, Canvas& c);
```

- [ ] **Step 2: Add title and footer helpers**

In `firmware/lib/m5render/pages.cpp`, replace `renderHeader` and `renderPageDots` with helpers using this structure:

```cpp
static const char* selectedSessionName(const StatusModel& m) {
  for (int i = 0; i < m.sessionN; ++i) {
    const auto& s = m.sessions[i];
    if ((s.selected || s.pinned) && s.name[0]) return s.name;
  }
  return nullptr;
}

static const char* headerTitle(PageId id, const StatusModel& m) {
  if (id == PageId::Sessions) return "TERMINALS";
  if (const char* selected = selectedSessionName(m)) return selected;
  if (m.wsWorktree[0]) return m.wsWorktree;
  const char* base = basenameOf(m.wsDir);
  if (std::strcmp(base, kDash) != 0) return base;
  return "Claude";
}

void renderHeader(PageId id, const StatusModel& m, Canvas& c) {
  c.fillRoundRect(0, 0, 320, 34, 0, color::bg);
  c.fillCircle(15, 17, 4, color::accent);
  c.text(headerTitle(id, m), 26, 17, Font::Title, Align::MiddleLeft, color::ink);

  if (id != PageId::Sessions && m.hasFocus && m.focusTotal >= 2) {
    char focus[20];
    snprintf(focus, sizeof(focus), "%s %d/%d",
             m.focusPinned ? "PINNED" : "AUTO", m.focusIndex, m.focusTotal);
    c.text(focus, 170, 17, Font::Label, Align::MiddleCenter, color::ink2);
  }

  const char* badge = activityLabel(m.activity);
  uint16_t bColor = blend565(activityColor(m.activity), color::bg, m.badgeBrightness);
  int bw = c.measureText(badge, Font::Label) + 8;
  c.fillRoundRect(316 - bw, 9, bw, 16, 3, color::accSoft);
  c.text(badge, 316 - bw / 2, 17, Font::Label, Align::MiddleCenter, bColor);
  c.drawHLine(10, 32, 300, color::hairline);
}

void renderPageDots(PageId active, int total, Canvas& c) {
  const int gap = 6, r = 2;
  const int totalW = (total - 1) * gap + total * (r * 2);
  int x = (320 - totalW) / 2 + r;
  int y = 232;
  for (int i = 0; i < total; ++i) {
    c.fillCircle(x, y, r,
                 i == static_cast<int>(active) ? color::ink : color::cardLine);
    x += r * 2 + gap;
  }
}

void renderFooter(PageId active, int total, const DeviceInfo& d, Canvas& c) {
  c.drawHLine(10, 215, 300, color::hairline);
  c.text(d.date[0] ? d.date : "--", 10, 226, Font::Label, Align::MiddleLeft, color::mute);
  renderPageDots(active, total, c);
  c.text(d.clock[0] ? d.clock : "--:--", 310, 226, Font::Label, Align::MiddleRight, color::ink2);
}
```

Keep `basenameOf` above these helpers, or move only helper declarations so `headerTitle` can call it.

- [ ] **Step 3: Wire page renderers to the new helpers**

Change each page drawer signature:

```cpp
static void drawOverview(const StatusModel& m, const DeviceInfo& d, Canvas& c)
static void drawCost(const StatusModel& m, const DeviceInfo& d, Canvas& c)
static void drawLimits(const StatusModel& m, const DeviceInfo& d, Canvas& c)
static void drawWorkspace(const StatusModel& m, const DeviceInfo& d, Canvas& c)
static void drawSessions(const StatusModel& m, const DeviceInfo& d, Canvas& c)
```

Replace `renderHeader(m, c)` with `renderHeader(PageId::<Page>, m, c)`.

Replace each `renderPageDots(PageId::<Page>, c)` with:

```cpp
renderFooter(PageId::<Page>, pageCountFor(m), d, c);
```

Update the router:

```cpp
void renderPage(PageId id, const StatusModel& m, const DeviceInfo& d, Canvas& c) {
  switch (id) {
    case PageId::Overview:  drawOverview(m, d, c);  break;
    case PageId::Cost:      drawCost(m, d, c);      break;
    case PageId::Limits:    drawLimits(m, d, c);    break;
    case PageId::Workspace: drawWorkspace(m, d, c); break;
    case PageId::Sessions:  drawSessions(m, d, c);  break;
  }
}
```

- [ ] **Step 4: Update existing tests to pass DeviceInfo and new signatures**

In `firmware/test/test_pages/test_main.cpp`, update old calls:

```cpp
renderPage(PageId::Overview, m, testDevice(), c);
renderPage(PageId::Cost, m, testDevice(), c);
renderPage(PageId::Limits, m, testDevice(), c);
renderPage(PageId::Workspace, m, testDevice(), c);
renderPage(PageId::Sessions, m, testDevice(), c);
renderHeader(PageId::Overview, m, c);
renderPageDots(PageId::Overview, kPageCount, c);
```

Update `test_page_dots_draws_four` to call `renderPageDots(PageId::Overview, kPageCount, c)`.

- [ ] **Step 5: Run native page tests and verify remaining failures**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
```

Expected: header/footer tests should be closer to green; overview model label may still fail until Task 3.

### Task 3: Move Model Into Overview Context Label And Preserve Layout

**Files:**
- Modify: `firmware/lib/m5render/pages.cpp`
- Modify: `firmware/test/test_pages/test_main.cpp`

- [ ] **Step 1: Build the context label**

In `drawOverview`, replace the hard-coded `CONTEXT` label with:

```cpp
  char ctxLabel[40];
  if (m.modelShort[0])
    snprintf(ctxLabel, sizeof(ctxLabel), "CONTEXT / %s", m.modelShort);
  else
    snprintf(ctxLabel, sizeof(ctxLabel), "CONTEXT");
  drawTile(c, 10, 56, 150, 74, ctxLabel, m.hasContext, buf, sub1,
           m.ctxUsedPct, m.hasContext && (m.exceeds200k || m.ctxUsedPct >= 80));
```

- [ ] **Step 2: Remove duplicate sessions-page heading**

In `drawSessions`, remove the line:

```cpp
  c.text("TERMINALS", 10, 42, Font::Label, Align::TopLeft, color::mute);
```

Set the first row start to keep a clean gap under the header:

```cpp
  int y = 48;
```

If `m.sessionN <= 0`, render the dash at `y = 58`:

```cpp
    c.text(kDash, 10, 58, Font::Body, Align::TopLeft, color::ink);
```

- [ ] **Step 3: Make bottom content respect the footer safe area**

Keep Overview tiles at their current y values because the lower tiles end at y=209 and the footer hairline starts at y=215.

In `drawWorkspace`, keep top-file rendering to three rows only if the last row does not exceed the footer line. Use:

```cpp
      const int n = m.topFileN > 2 ? 2 : m.topFileN;
```

This prevents the third top-file row from colliding with the footer on dirty workspaces.

- [ ] **Step 4: Run native page tests and verify GREEN**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
```

Expected: all `test_pages` tests pass.

- [ ] **Step 5: Commit firmware renderer changes**

```bash
git add firmware/lib/m5render/pages.h firmware/lib/m5render/pages.cpp firmware/test/test_pages/test_main.cpp
git commit -m "feat(firmware): redesign status screen header footer"
```

### Task 4: Refresh Live DeviceInfo From App

**Files:**
- Modify: `firmware/lib/m5render/app.cpp`
- Test: `firmware/test/test_app/test_main.cpp`

- [ ] **Step 1: Update App render call**

In `firmware/lib/m5render/app.cpp`, change `App::render()` to refresh `DeviceInfo` before both Live and Waiting render paths:

```cpp
void App::render() {
    if (!dirty_) return;
    M5CT_DBG("render link=%d page=%d", static_cast<int>(link_), static_cast<int>(page_));
    canvas_.begin();
    refreshDeviceInfo();
    if (link_ == LinkState::Live) {
        renderPage(page_, model_, dev_, canvas_);
    } else {
        renderWaiting(dev_, link_ == LinkState::Linked, canvas_);
    }
    canvas_.end();
    M5CT_DBG("render end");
    dirty_ = false;
}
```

- [ ] **Step 2: Update compile-time call sites**

Search for old `renderPage(` calls:

```bash
rg -n "renderPage\\(" firmware
```

Expected remaining call sites pass a `DeviceInfo` argument.

- [ ] **Step 3: Run app and page native tests**

Run:

```bash
pio test --project-dir firmware -e native -f test_pages
pio test --project-dir firmware -e native -f test_app
```

Expected: both suites pass.

- [ ] **Step 4: Commit app integration**

```bash
git add firmware/lib/m5render/app.cpp firmware/test/test_app/test_main.cpp
git commit -m "fix(firmware): refresh device info for live pages"
```

### Task 5: Full Verification And Formatting

**Files:**
- Read: `package.json`
- Read: `firmware/platformio.ini`

- [ ] **Step 1: Run firmware native tests**

Run:

```bash
pio test --project-dir firmware -e native
```

Expected: all native firmware tests pass.

- [ ] **Step 2: Run TypeScript tests**

Run:

```bash
pnpm test
```

Expected: all Vitest suites pass.

- [ ] **Step 3: Run Biome**

Run:

```bash
pnpm lint
```

Expected: Biome check passes.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intended firmware/spec/plan changes are present.
