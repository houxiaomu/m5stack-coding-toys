#include <unity.h>

#include "m5proto.h"

void test_protocol_version_is_one() {
    TEST_ASSERT_EQUAL_UINT8(1, m5proto::PROTOCOL_VERSION);
}

void setUp() {}
void tearDown() {}

int main(int /*argc*/, char** /*argv*/) {
    UNITY_BEGIN();
    RUN_TEST(test_protocol_version_is_one);
    return UNITY_END();
}
