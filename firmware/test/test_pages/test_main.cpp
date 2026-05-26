#include <unity.h>
#include <cstring>

#include "mock_canvas.h"
#include "pages.h"
#include "status_model.h"

using namespace m5render;

void test_overview_renders_context_tile_with_bar() {
  StatusModel m; m.hasContext = true; m.ctxUsedPct = 47;
  MockCanvas c; renderPage(PageId::Overview, m, c);
  TEST_ASSERT_TRUE(c.called("text", "CONTEXT"));
  TEST_ASSERT_TRUE(c.calledPrefix("microBar"));
}

void test_overview_degrades_when_no_context() {
  StatusModel m; m.hasContext = false;
  MockCanvas c; renderPage(PageId::Overview, m, c);
  TEST_ASSERT_TRUE(c.called("text", "—"));  // placeholder, no crash
}

void test_limits_uses_single_weekly_row() {
  StatusModel m; m.hasWeekly = true; m.weeklyPct = 18;
  MockCanvas c; renderPage(PageId::Limits, m, c);
  TEST_ASSERT_TRUE(c.called("text", "WEEKLY"));
  TEST_ASSERT_FALSE(c.called("text", "SONNET WK"));  // per-model split removed
  TEST_ASSERT_FALSE(c.called("text", "OPUS WK"));
}

void test_limits_renders_three_rows() {
  StatusModel m;
  m.hasContext = true; m.ctxUsedPct = 47;
  m.hasBlock = true; m.blockPct = 22;
  m.hasWeekly = true; m.weeklyPct = 18;
  MockCanvas c; renderPage(PageId::Limits, m, c);
  TEST_ASSERT_TRUE(c.called("text", "CONTEXT"));
  TEST_ASSERT_TRUE(c.called("text", "5H BLOCK"));
  TEST_ASSERT_TRUE(c.called("text", "WEEKLY"));
}

void test_waiting_uses_device_info_not_status() {
  DeviceInfo d; strcpy(d.fw, "0.4.0"); d.batteryPct = 78;
  MockCanvas c; renderWaiting(d, false, c);
  TEST_ASSERT_TRUE(c.calledPrefix("fillScreen"));
  // Device strip: board (default "CoreS3") + fw, joined by two spaces.
  TEST_ASSERT_TRUE(c.called("text", "CoreS3  0.4.0"));
  // Bottom-right battery: "Bat <pct>%" when not charging.
  TEST_ASSERT_TRUE(c.called("text", "Bat 78%"));
}

void test_cost_draws_sparkline_when_burn_history_present() {
  StatusModel m;
  m.hasCost = true; m.costSessionUsd = 1.23f;
  m.burnN = 5; for (int i = 0; i < 5; ++i) m.burn[i] = float(i + 1);
  MockCanvas c; renderPage(PageId::Cost, m, c);
  TEST_ASSERT_TRUE(c.called("sparkline", "5"));
}

void test_cost_no_sparkline_when_no_history() {
  StatusModel m; m.hasCost = true; m.burnN = 0;
  MockCanvas c; renderPage(PageId::Cost, m, c);
  TEST_ASSERT_FALSE(c.calledPrefix("sparkline"));
}

void test_cost_degrades_when_no_cost() {
  StatusModel m; m.hasCost = false;
  MockCanvas c; renderPage(PageId::Cost, m, c);
  TEST_ASSERT_TRUE(c.called("text", "—"));
}

void test_workspace_degrades_when_no_git() {
  StatusModel m; m.hasGit = false;
  MockCanvas c; renderPage(PageId::Workspace, m, c);
  TEST_ASSERT_TRUE(c.called("text", "—"));
}

void test_workspace_dirty_renders_dense_diff() {
  StatusModel m;
  m.hasGit = true;
  strcpy(m.branch, "feat/workspace-page-density");
  strcpy(m.wsDir, "/Users/houxiaomu/playground/m5toys");
  m.staged = 2;
  m.unstaged = 5;
  m.untracked = 1;
  m.hasDiff = true;
  m.diffFilesChanged = 8;
  m.diffLinesAdded = 128;
  m.diffLinesRemoved = 24;
  m.topFileN = 1;
  strcpy(m.topFiles[0].path, "firmware/lib/m5render/pages.cpp");
  m.topFiles[0].added = 84;
  m.topFiles[0].removed = 12;

  MockCanvas c; renderPage(PageId::Workspace, m, c);

  TEST_ASSERT_TRUE(c.called("text", "dirty"));
  TEST_ASSERT_TRUE(c.called("text", "Files"));
  TEST_ASSERT_TRUE(c.called("text", "2 staged   5 modified   1 new"));
  TEST_ASSERT_TRUE(c.called("text", "Lines"));
  TEST_ASSERT_TRUE(c.called("text", "+128       -24"));
  TEST_ASSERT_TRUE(c.called("text", "Top"));
  TEST_ASSERT_TRUE(c.called("text", "pages.cpp"));
}

void test_workspace_clean_renders_status_and_commit() {
  StatusModel m;
  m.hasGit = true;
  strcpy(m.branch, "main");
  strcpy(m.wsDir, "/Users/houxiaomu/playground/m5toys");
  strcpy(m.lastCommitHash, "2314b8b");
  strcpy(m.lastCommitMsg, "densify workspace page");
  m.lastCommitMins = 12;

  MockCanvas c; renderPage(PageId::Workspace, m, c);

  TEST_ASSERT_TRUE(c.called("text", "clean"));
  TEST_ASSERT_TRUE(c.called("text", "Status"));
  TEST_ASSERT_TRUE(c.called("text", "no local changes"));
  TEST_ASSERT_TRUE(c.called("text", "12m"));
  TEST_ASSERT_TRUE(c.called("text", "2314b8b"));
}

void test_header_warning_badge_when_ctx_high() {
  StatusModel m; m.hasContext = true; m.ctxUsedPct = 92;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "CTX HIGH"));
}

void test_header_badge_working_when_no_warn() {
  StatusModel m; m.hasContext = true; m.ctxUsedPct = 10;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.called("text", "WORKING"));
  TEST_ASSERT_FALSE(c.called("text", "CTX HIGH"));
}

void test_cost_rows_degrade_when_no_today_or_weekly() {
  StatusModel m;
  m.hasCost = true; m.costSessionUsd = 1.23f;
  m.hasToday = false; m.hasWeekly = false;
  MockCanvas c; renderPage(PageId::Cost, m, c);
  // Row labels still render; their values fall back to the dash placeholder.
  TEST_ASSERT_TRUE(c.called("text", "TODAY"));
  TEST_ASSERT_TRUE(c.called("text", "WEEKLY"));
  TEST_ASSERT_TRUE(c.called("text", "—"));
}

void test_header_status_dot_drawn() {
  StatusModel m;
  MockCanvas c; renderHeader(m, c);
  TEST_ASSERT_TRUE(c.calledPrefix("fillCircle"));
}

void test_page_dots_draws_four() {
  MockCanvas c; renderPageDots(PageId::Overview, c);
  TEST_ASSERT_EQUAL(kPageCount, c.countPrefix("fillCircle"));
}

void test_overview_renders_header_and_dots() {
  StatusModel m; m.hasContext = true; m.ctxUsedPct = 47;
  MockCanvas c; renderPage(PageId::Overview, m, c);
  // header status dot + page dots all use fillCircle; at least the 4 page dots.
  TEST_ASSERT_TRUE(c.countPrefix("fillCircle") >= kPageCount);
}

void test_waiting_linked_shows_connected_copy() {
  DeviceInfo d; MockCanvas c;
  renderWaiting(d, true, c);
  TEST_ASSERT_TRUE(c.called("text", "Connected"));
}

void test_waiting_nolink_shows_waiting_copy() {
  DeviceInfo d; MockCanvas c;
  renderWaiting(d, false, c);
  TEST_ASSERT_TRUE(c.called("text", "Waiting for host"));
}

void setup() {
  UNITY_BEGIN();
  RUN_TEST(test_overview_renders_context_tile_with_bar);
  RUN_TEST(test_overview_degrades_when_no_context);
  RUN_TEST(test_limits_uses_single_weekly_row);
  RUN_TEST(test_limits_renders_three_rows);
  RUN_TEST(test_waiting_uses_device_info_not_status);
  RUN_TEST(test_cost_draws_sparkline_when_burn_history_present);
  RUN_TEST(test_cost_no_sparkline_when_no_history);
  RUN_TEST(test_cost_degrades_when_no_cost);
  RUN_TEST(test_workspace_degrades_when_no_git);
  RUN_TEST(test_workspace_dirty_renders_dense_diff);
  RUN_TEST(test_workspace_clean_renders_status_and_commit);
  RUN_TEST(test_header_warning_badge_when_ctx_high);
  RUN_TEST(test_header_badge_working_when_no_warn);
  RUN_TEST(test_cost_rows_degrade_when_no_today_or_weekly);
  RUN_TEST(test_header_status_dot_drawn);
  RUN_TEST(test_page_dots_draws_four);
  RUN_TEST(test_overview_renders_header_and_dots);
  RUN_TEST(test_waiting_linked_shows_connected_copy);
  RUN_TEST(test_waiting_nolink_shows_waiting_copy);
  UNITY_END();
}
void loop() {}
int main() { setup(); return 0; }
