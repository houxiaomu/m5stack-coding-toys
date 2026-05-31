#include <unity.h>
#include <cstdint>

#include "ring_buffer.h"

void test_ring_preserves_order_across_wrap() {
  m5hal::ByteRingBuffer<5> ring;
  const uint8_t first[] = {'a', 'b', 'c'};
  TEST_ASSERT_EQUAL_UINT32(3, ring.write(first, sizeof(first)));
  uint8_t out[2]{};
  TEST_ASSERT_EQUAL_UINT32(2, ring.read(out, sizeof(out)));
  TEST_ASSERT_EQUAL_UINT8('a', out[0]);
  TEST_ASSERT_EQUAL_UINT8('b', out[1]);
  const uint8_t second[] = {'d', 'e', 'f', 'g'};
  TEST_ASSERT_EQUAL_UINT32(4, ring.write(second, sizeof(second)));
  uint8_t rest[5]{};
  TEST_ASSERT_EQUAL_UINT32(5, ring.read(rest, sizeof(rest)));
  TEST_ASSERT_EQUAL_UINT8('c', rest[0]);
  TEST_ASSERT_EQUAL_UINT8('d', rest[1]);
  TEST_ASSERT_EQUAL_UINT8('e', rest[2]);
  TEST_ASSERT_EQUAL_UINT8('f', rest[3]);
  TEST_ASSERT_EQUAL_UINT8('g', rest[4]);
}

void test_ring_drops_new_bytes_when_full() {
  m5hal::ByteRingBuffer<3> ring;
  const uint8_t bytes[] = {'a', 'b', 'c', 'd'};
  TEST_ASSERT_EQUAL_UINT32(3, ring.write(bytes, sizeof(bytes)));
  TEST_ASSERT_EQUAL_UINT32(3, ring.available());
  uint8_t out[3]{};
  TEST_ASSERT_EQUAL_UINT32(3, ring.read(out, sizeof(out)));
  TEST_ASSERT_EQUAL_UINT8('a', out[0]);
  TEST_ASSERT_EQUAL_UINT8('b', out[1]);
  TEST_ASSERT_EQUAL_UINT8('c', out[2]);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_ring_preserves_order_across_wrap);
  RUN_TEST(test_ring_drops_new_bytes_when_full);
  return UNITY_END();
}
