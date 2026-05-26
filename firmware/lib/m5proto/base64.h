#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace m5proto {

// Standard base64 (RFC 4648) with '=' padding. Output is JSON-safe (no chars
// needing escaping), so callers can embed it directly in a JSON string.
inline std::string base64Encode(const uint8_t* data, std::size_t n) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((n + 2) / 3) * 4);
  std::size_t i = 0;
  for (; i + 3 <= n; i += 3) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8) | data[i + 2];
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += T[(v >> 6) & 0x3F];
    out += T[v & 0x3F];
  }
  const std::size_t rem = n - i;
  if (rem == 1) {
    const uint32_t v = uint32_t(data[i]) << 16;
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += "==";
  } else if (rem == 2) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8);
    out += T[(v >> 18) & 0x3F];
    out += T[(v >> 12) & 0x3F];
    out += T[(v >> 6) & 0x3F];
    out += '=';
  }
  return out;
}

// Streaming base64: encodes `n` bytes and invokes write(ptr, len) for output
// pieces, never holding the whole result in memory. Required for large frames
// (a 320×240 RGB565 screenshot is ~204KB base64 — too big for an ESP32
// std::string on the internal heap). `write` must accept (const char*, size_t).
template <typename WriteFn>
inline void base64EncodeStream(const uint8_t* data, std::size_t n, WriteFn write) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  char buf[4096];  // multiple of 4; flushed before it can overflow
  std::size_t bi = 0;
  std::size_t i = 0;
  for (; i + 3 <= n; i += 3) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8) | data[i + 2];
    buf[bi++] = T[(v >> 18) & 0x3F];
    buf[bi++] = T[(v >> 12) & 0x3F];
    buf[bi++] = T[(v >> 6) & 0x3F];
    buf[bi++] = T[v & 0x3F];
    if (bi >= sizeof(buf)) { write(buf, bi); bi = 0; }
  }
  const std::size_t rem = n - i;
  if (rem == 1) {
    const uint32_t v = uint32_t(data[i]) << 16;
    buf[bi++] = T[(v >> 18) & 0x3F];
    buf[bi++] = T[(v >> 12) & 0x3F];
    buf[bi++] = '=';
    buf[bi++] = '=';
  } else if (rem == 2) {
    const uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8);
    buf[bi++] = T[(v >> 18) & 0x3F];
    buf[bi++] = T[(v >> 12) & 0x3F];
    buf[bi++] = T[(v >> 6) & 0x3F];
    buf[bi++] = '=';
  }
  if (bi) write(buf, bi);
}

}  // namespace m5proto
