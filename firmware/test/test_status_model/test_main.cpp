#include <unity.h>
#include "status_model.h"
using namespace m5render;

void test_minimal_frame_sets_sessionActive() {
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\"}", m));
  TEST_ASSERT_TRUE(m.sessionActive);
  TEST_ASSERT_FALSE(m.hasContext);
  TEST_ASSERT_FALSE(m.hasGit);
}

void test_full_frame_populates_groups() {
  const char* j =
    "{\"state\":\"active\",\"model\":{\"short\":\"Sonnet 4.6\"},"
    "\"context\":{\"usedPct\":47,\"tokens\":94000,\"limit\":200000,\"exceeds200k\":false},"
    "\"block\":{\"usedPct\":22,\"resetInMin\":132},\"weekly\":{\"usedPct\":18},"
    "\"git\":{\"branch\":\"feat/x\",\"ahead\":3,\"staged\":2}}";
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame(j, m));
  TEST_ASSERT_EQUAL_STRING("Sonnet 4.6", m.modelShort);
  TEST_ASSERT_TRUE(m.hasContext); TEST_ASSERT_EQUAL(47, m.ctxUsedPct);
  TEST_ASSERT_TRUE(m.hasBlock);   TEST_ASSERT_EQUAL(132, m.blockResetInMin);
  TEST_ASSERT_TRUE(m.hasWeekly);  TEST_ASSERT_EQUAL(18, m.weeklyPct);
  TEST_ASSERT_TRUE(m.hasGit);     TEST_ASSERT_EQUAL_STRING("feat/x", m.branch);
  TEST_ASSERT_EQUAL(3, m.ahead);
}

void test_rejects_bad_json() {
  StatusModel m;
  TEST_ASSERT_FALSE(parseStatusFrame("{not json", m));
}

void test_burn_history_keeps_most_recent_16() {
  // 20 ascending samples 0..19; producer sends a rolling window where the
  // newest samples matter, so we keep the last 16 (skip the oldest 4).
  const char* j =
    "{\"state\":\"active\",\"burnHistory\":"
    "[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]}";
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame(j, m));
  TEST_ASSERT_EQUAL(16, m.burnN);
  TEST_ASSERT_EQUAL_FLOAT(4.0f, m.burn[0]);   // first kept = index 4 after skipping 4
  TEST_ASSERT_EQUAL_FLOAT(19.0f, m.burn[15]); // last kept = newest sample
}

void test_state_active_and_idle_map_to_sessionActive() {
  StatusModel m1;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"active\"}", m1));
  TEST_ASSERT_TRUE(m1.sessionActive);

  StatusModel m2;
  TEST_ASSERT_TRUE(parseStatusFrame("{\"state\":\"idle\"}", m2));
  TEST_ASSERT_FALSE(m2.sessionActive);
}

void test_git_diff_parses_summary_and_clamps_top_files() {
  const char* j =
    "{\"state\":\"active\",\"git\":{\"branch\":\"feat/diff\","
    "\"diff\":{\"filesChanged\":8,\"linesAdded\":120,\"linesRemoved\":45,"
    "\"topFiles\":["
    "{\"path\":\"firmware/src/main.cpp\",\"added\":40,\"removed\":5},"
    "{\"path\":\"lib/m5render/status_model.cpp\",\"added\":30,\"removed\":20},"
    "{\"path\":\"test/status_model/test_main.cpp\",\"added\":25,\"removed\":10},"
    "{\"path\":\"daemon/src/status.ts\",\"added\":100,\"removed\":100}"
    "]}}}";
  StatusModel m;
  TEST_ASSERT_TRUE(parseStatusFrame(j, m));
  TEST_ASSERT_TRUE(m.hasGit);
  TEST_ASSERT_TRUE(m.hasDiff);
  TEST_ASSERT_EQUAL(8, m.diffFilesChanged);
  TEST_ASSERT_EQUAL(120, m.diffLinesAdded);
  TEST_ASSERT_EQUAL(45, m.diffLinesRemoved);
  TEST_ASSERT_EQUAL(3, m.topFileN);
  TEST_ASSERT_EQUAL_STRING("firmware/src/main.cpp", m.topFiles[0].path);
  TEST_ASSERT_EQUAL(40, m.topFiles[0].added);
  TEST_ASSERT_EQUAL(5, m.topFiles[0].removed);
  TEST_ASSERT_EQUAL_STRING("lib/m5render/status_model.cpp", m.topFiles[1].path);
  TEST_ASSERT_EQUAL(30, m.topFiles[1].added);
  TEST_ASSERT_EQUAL(20, m.topFiles[1].removed);
  TEST_ASSERT_EQUAL_STRING("test/status_model/test_main.cpp", m.topFiles[2].path);
  TEST_ASSERT_EQUAL(25, m.topFiles[2].added);
  TEST_ASSERT_EQUAL(10, m.topFiles[2].removed);
}

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

void setup() {
  UNITY_BEGIN();
  RUN_TEST(test_minimal_frame_sets_sessionActive);
  RUN_TEST(test_full_frame_populates_groups);
  RUN_TEST(test_rejects_bad_json);
  RUN_TEST(test_burn_history_keeps_most_recent_16);
  RUN_TEST(test_state_active_and_idle_map_to_sessionActive);
  RUN_TEST(test_git_diff_parses_summary_and_clamps_top_files);
  RUN_TEST(test_activity_defaults_to_working_when_absent);
  RUN_TEST(test_activity_parses_all_three_values);
  UNITY_END();
}
void loop() {}
int main() { setup(); return 0; }
