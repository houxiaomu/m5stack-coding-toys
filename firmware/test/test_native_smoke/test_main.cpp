#include <unity.h>

#include "device_id.h"
#include "m5proto.h"

void test_protocol_version_is_one() {
    TEST_ASSERT_EQUAL_UINT8(1, m5proto::PROTOCOL_VERSION);
}

void test_format_device_id_uses_uppercase_suffix() {
    TEST_ASSERT_EQUAL_STRING("M5SE-A1B2C3", m5hal::formatDeviceId("M5SE", 0xA1B2C3).c_str());
    TEST_ASSERT_EQUAL_STRING("M5CP-000001", m5hal::formatDeviceId("M5CP", 1).c_str());
}

void setUp() {}
void tearDown() {}

int main(int /*argc*/, char** /*argv*/) {
    UNITY_BEGIN();
    RUN_TEST(test_protocol_version_is_one);
    RUN_TEST(test_format_device_id_uses_uppercase_suffix);
    return UNITY_END();
}
