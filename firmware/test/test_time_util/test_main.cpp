#include <unity.h>

#include "time_util.h"

using namespace m5render;

void setUp() {}
void tearDown() {}

void test_same_day_east_offset() {
  // 2026-05-30 04:00 UTC, +08:00 → 2026-05-30 12:00 local
  LocalClock lc = localFromUtc(2026, 5, 30, 4, 0, 0, 480);
  TEST_ASSERT_EQUAL_INT(2026, lc.year);
  TEST_ASSERT_EQUAL_INT(5, lc.month);
  TEST_ASSERT_EQUAL_INT(30, lc.day);
  TEST_ASSERT_EQUAL_INT(12, lc.hour);
  TEST_ASSERT_EQUAL_INT(0, lc.minute);
}

void test_cross_midnight_forward() {
  // 2026-05-30 20:00 UTC, +08:00 → 2026-05-31 04:00 local (date rolls +1)
  LocalClock lc = localFromUtc(2026, 5, 30, 20, 0, 0, 480);
  TEST_ASSERT_EQUAL_INT(31, lc.day);
  TEST_ASSERT_EQUAL_INT(4, lc.hour);
}

void test_cross_midnight_backward_negative_offset() {
  // 2026-05-30 02:00 UTC, -05:00 → 2026-05-29 21:00 local (date rolls -1)
  LocalClock lc = localFromUtc(2026, 5, 30, 2, 0, 0, -300);
  TEST_ASSERT_EQUAL_INT(29, lc.day);
  TEST_ASSERT_EQUAL_INT(21, lc.hour);
}

void test_cross_month_boundary() {
  // 2026-05-31 20:00 UTC, +08:00 → 2026-06-01 04:00 local (month rolls +1)
  LocalClock lc = localFromUtc(2026, 5, 31, 20, 0, 0, 480);
  TEST_ASSERT_EQUAL_INT(6, lc.month);
  TEST_ASSERT_EQUAL_INT(1, lc.day);
  TEST_ASSERT_EQUAL_INT(4, lc.hour);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_same_day_east_offset);
  RUN_TEST(test_cross_midnight_forward);
  RUN_TEST(test_cross_midnight_backward_negative_offset);
  RUN_TEST(test_cross_month_boundary);
  return UNITY_END();
}
