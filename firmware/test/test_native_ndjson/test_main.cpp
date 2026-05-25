#include <unity.h>
#include <cstring>
#include <string>
#include <vector>

#include "ndjson.h"

using m5proto::NdjsonFramer;

static std::vector<std::string> drain(NdjsonFramer& f, const char* chunk) {
    std::vector<std::string> out;
    f.push(reinterpret_cast<const uint8_t*>(chunk), std::strlen(chunk),
           [&out](const char* s, std::size_t n) { out.emplace_back(s, n); });
    return out;
}

void test_emits_one_complete_line() {
    NdjsonFramer f;
    auto lines = drain(f, "hello\n");
    TEST_ASSERT_EQUAL_size_t(1, lines.size());
    TEST_ASSERT_EQUAL_STRING("hello", lines[0].c_str());
}

void test_buffers_partial_until_newline() {
    NdjsonFramer f;
    TEST_ASSERT_EQUAL_size_t(0, drain(f, "part1").size());
    TEST_ASSERT_EQUAL_size_t(0, drain(f, "part2").size());
    auto out = drain(f, "\n");
    TEST_ASSERT_EQUAL_size_t(1, out.size());
    TEST_ASSERT_EQUAL_STRING("part1part2", out[0].c_str());
}

void test_multiple_lines_in_one_chunk() {
    NdjsonFramer f;
    auto out = drain(f, "a\nb\nc\n");
    TEST_ASSERT_EQUAL_size_t(3, out.size());
    TEST_ASSERT_EQUAL_STRING("a", out[0].c_str());
    TEST_ASSERT_EQUAL_STRING("b", out[1].c_str());
    TEST_ASSERT_EQUAL_STRING("c", out[2].c_str());
}

void test_skips_empty_lines() {
    NdjsonFramer f;
    auto out = drain(f, "a\n\n\nb\n");
    TEST_ASSERT_EQUAL_size_t(2, out.size());
    TEST_ASSERT_EQUAL_STRING("a", out[0].c_str());
    TEST_ASSERT_EQUAL_STRING("b", out[1].c_str());
}

void test_truncates_oversize_line() {
    NdjsonFramer f(/*max_len=*/8);
    std::string giant(20, 'x');
    giant.push_back('\n');
    giant.append("ok\n");
    std::vector<std::string> out;
    f.push(reinterpret_cast<const uint8_t*>(giant.data()), giant.size(),
           [&out](const char* s, std::size_t n) { out.emplace_back(s, n); });
    TEST_ASSERT_EQUAL_size_t(1, out.size());
    TEST_ASSERT_EQUAL_STRING("ok", out[0].c_str());
}

void test_frame_appends_newline() {
    std::string out;
    NdjsonFramer::frame("hello", [&out](const char* s, std::size_t n) { out.append(s, n); });
    TEST_ASSERT_EQUAL_STRING("hello\n", out.c_str());
}

void setUp() {}
void tearDown() {}

int main(int /*argc*/, char** /*argv*/) {
    UNITY_BEGIN();
    RUN_TEST(test_emits_one_complete_line);
    RUN_TEST(test_buffers_partial_until_newline);
    RUN_TEST(test_multiple_lines_in_one_chunk);
    RUN_TEST(test_skips_empty_lines);
    RUN_TEST(test_truncates_oversize_line);
    RUN_TEST(test_frame_appends_newline);
    return UNITY_END();
}
