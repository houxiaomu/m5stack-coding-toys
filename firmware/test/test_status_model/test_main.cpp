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

void setup() {
  UNITY_BEGIN();
  RUN_TEST(test_minimal_frame_sets_sessionActive);
  RUN_TEST(test_full_frame_populates_groups);
  RUN_TEST(test_rejects_bad_json);
  RUN_TEST(test_burn_history_keeps_most_recent_16);
  RUN_TEST(test_state_active_and_idle_map_to_sessionActive);
  UNITY_END();
}
void loop() {}
int main() { setup(); return 0; }
