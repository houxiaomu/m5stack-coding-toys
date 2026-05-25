#include <unity.h>
#include <cstring>

#include "codec.h"
#include "messages.h"

using m5proto::DecodedEnvelope;
using m5proto::DecodeResult;

void test_decode_ping() {
    const char json[] = R"({"v":1,"k":"ping","t":12345,"p":{}})";
    DecodedEnvelope env;
    DecodeResult r = m5proto::decode(json, std::strlen(json), env);
    TEST_ASSERT_EQUAL(DecodeResult::Ok, r);
    TEST_ASSERT_EQUAL_STRING(m5proto::kind::ping, env.kind);
    TEST_ASSERT_EQUAL_UINT32(12345, env.t);
    TEST_ASSERT_EQUAL_STRING("", env.id);
}

void test_decode_with_id() {
    const char json[] = R"({"v":1,"id":"abc","k":"hello","t":0,"p":{"caps":["display"]}})";
    DecodedEnvelope env;
    TEST_ASSERT_EQUAL(DecodeResult::Ok, m5proto::decode(json, std::strlen(json), env));
    TEST_ASSERT_EQUAL_STRING("abc", env.id);
    TEST_ASSERT_EQUAL_STRING(m5proto::kind::hello, env.kind);
}

void test_decode_rejects_wrong_version() {
    const char json[] = R"({"v":2,"k":"ping","t":0,"p":{}})";
    DecodedEnvelope env;
    TEST_ASSERT_EQUAL(DecodeResult::BadVersion, m5proto::decode(json, std::strlen(json), env));
}

void test_decode_rejects_malformed_json() {
    const char json[] = "not json at all";
    DecodedEnvelope env;
    TEST_ASSERT_EQUAL(DecodeResult::BadJson, m5proto::decode(json, std::strlen(json), env));
}

void test_decode_rejects_missing_kind() {
    const char json[] = R"({"v":1,"t":0,"p":{}})";
    DecodedEnvelope env;
    TEST_ASSERT_EQUAL(DecodeResult::BadShape, m5proto::decode(json, std::strlen(json), env));
}

void test_encode_pong() {
    char out[256];
    std::size_t n = m5proto::encode_pong("xyz", 999, out, sizeof(out));
    TEST_ASSERT_TRUE(n > 0);
    TEST_ASSERT_TRUE(n < sizeof(out));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"k\":\"pong\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"id\":\"xyz\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"t\":999"));
}

void test_encode_hello_ack() {
    char out[512];
    const char* caps[] = {"display", "touch"};
    std::size_t n = m5proto::encode_hello_ack(
        "h1", 100, "cores3-se", "0.1.0", caps, 2, "M5SE-AABBCC", out, sizeof(out));
    TEST_ASSERT_TRUE(n > 0);
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"k\":\"hello.ack\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"board\":\"cores3-se\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"display\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"touch\""));
    TEST_ASSERT_NOT_NULL(std::strstr(out, "\"device_id\":\"M5SE-AABBCC\""));
}

void test_encode_returns_zero_when_buffer_too_small() {
    char out[8];
    std::size_t n = m5proto::encode_pong("xyz", 999, out, sizeof(out));
    TEST_ASSERT_EQUAL_size_t(0, n);
}

void setUp() {}
void tearDown() {}

int main(int /*argc*/, char** /*argv*/) {
    UNITY_BEGIN();
    RUN_TEST(test_decode_ping);
    RUN_TEST(test_decode_with_id);
    RUN_TEST(test_decode_rejects_wrong_version);
    RUN_TEST(test_decode_rejects_malformed_json);
    RUN_TEST(test_decode_rejects_missing_kind);
    RUN_TEST(test_encode_pong);
    RUN_TEST(test_encode_hello_ack);
    RUN_TEST(test_encode_returns_zero_when_buffer_too_small);
    return UNITY_END();
}
