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

}  // namespace m5proto
