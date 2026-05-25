#include <unity.h>
#include <cstdint>
#include <cstring>
#include <string>

#include "base64.h"
#include "codec.h"

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

void test_ack_ok_decodes() {
  std::string line = m5proto::encode_screenshot_ack("m1", 0, true, 320, 240, "iVBORw==", nullptr);
  m5proto::DecodedEnvelope env;
  TEST_ASSERT_EQUAL(static_cast<int>(m5proto::DecodeResult::Ok),
                    static_cast<int>(m5proto::decode(line.c_str(), line.size(), env)));
  TEST_ASSERT_EQUAL_STRING("screenshot.ack", env.kind);
  TEST_ASSERT_EQUAL_STRING("m1", env.id);
  TEST_ASSERT_TRUE(env.doc["p"]["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("iVBORw==", env.doc["p"]["png_b64"].as<const char*>());
  TEST_ASSERT_EQUAL(320, env.doc["p"]["w"].as<int>());
}

void test_ack_err_decodes() {
  std::string line = m5proto::encode_screenshot_ack(nullptr, 0, false, 0, 0, "", "capture_unsupported");
  m5proto::DecodedEnvelope env;
  TEST_ASSERT_EQUAL(static_cast<int>(m5proto::DecodeResult::Ok),
                    static_cast<int>(m5proto::decode(line.c_str(), line.size(), env)));
  TEST_ASSERT_FALSE(env.doc["p"]["ok"].as<bool>());
  TEST_ASSERT_EQUAL_STRING("capture_unsupported", env.doc["p"]["err"].as<const char*>());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_base64_empty);
  RUN_TEST(test_base64_pad2);
  RUN_TEST(test_base64_pad1);
  RUN_TEST(test_base64_nopad);
  RUN_TEST(test_base64_png_magic);
  RUN_TEST(test_ack_ok_decodes);
  RUN_TEST(test_ack_err_decodes);
  return UNITY_END();
}
