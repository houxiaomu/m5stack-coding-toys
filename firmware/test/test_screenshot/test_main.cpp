#include <unity.h>
#include <cstdint>
#include <string>

#include "base64.h"

using m5proto::base64Encode;

static std::string b64(const std::string& s) {
  return base64Encode(reinterpret_cast<const uint8_t*>(s.data()), s.size());
}

void setUp() {}
void tearDown() {}

void test_base64_empty() { TEST_ASSERT_EQUAL_STRING("", b64("").c_str()); }
void test_base64_pad2()  { TEST_ASSERT_EQUAL_STRING("TQ==", b64("M").c_str()); }
void test_base64_pad1()  { TEST_ASSERT_EQUAL_STRING("TWE=", b64("Ma").c_str()); }
void test_base64_nopad() { TEST_ASSERT_EQUAL_STRING("TWFu", b64("Man").c_str()); }

void test_base64_png_magic() {
  const uint8_t bytes[] = {0x89, 'P', 'N', 'G'};
  TEST_ASSERT_EQUAL_STRING("iVBORw==", base64Encode(bytes, 4).c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_base64_empty);
  RUN_TEST(test_base64_pad2);
  RUN_TEST(test_base64_pad1);
  RUN_TEST(test_base64_nopad);
  RUN_TEST(test_base64_png_magic);
  return UNITY_END();
}
