#pragma once

#include <ArduinoJson.h>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>

#include "m5proto.h"
#include "messages.h"

namespace m5proto {

enum class DecodeResult : uint8_t {
    Ok = 0,
    BadJson,
    BadShape,
    BadVersion,
};

struct DecodedEnvelope {
    char         kind[32];
    char         id[32];
    uint64_t     t;
    JsonDocument doc;
};

inline DecodeResult decode(const char* line, std::size_t len, DecodedEnvelope& out) {
    out.doc.clear();
    DeserializationError err = deserializeJson(out.doc, line, len);
    if (err) return DecodeResult::BadJson;
    if (!out.doc.is<JsonObject>()) return DecodeResult::BadShape;
    JsonObject root = out.doc.as<JsonObject>();
    if (!root["v"].is<uint8_t>()) return DecodeResult::BadShape;
    if (root["v"].as<uint8_t>() != PROTOCOL_VERSION) return DecodeResult::BadVersion;
    if (!root["k"].is<const char*>()) return DecodeResult::BadShape;
    if (!root["t"].is<uint64_t>() && !root["t"].is<uint32_t>()) return DecodeResult::BadShape;
    if (!root["p"].is<JsonObject>()) return DecodeResult::BadShape;
    std::strncpy(out.kind, root["k"].as<const char*>(), sizeof(out.kind) - 1);
    out.kind[sizeof(out.kind) - 1] = '\0';
    out.t = root["t"].as<uint64_t>();
    if (root["id"].is<const char*>()) {
        std::strncpy(out.id, root["id"].as<const char*>(), sizeof(out.id) - 1);
        out.id[sizeof(out.id) - 1] = '\0';
    } else {
        out.id[0] = '\0';
    }
    return DecodeResult::Ok;
}

namespace detail {
inline std::size_t serialize_or_zero(const JsonDocument& doc, char* out, std::size_t out_cap) {
    const std::size_t n = measureJson(doc);
    if (n + 1 > out_cap) return 0;
    return serializeJson(doc, out, out_cap);
}
}  // namespace detail

inline std::size_t encode_pong(const char* id, uint64_t t, char* out, std::size_t out_cap) {
    JsonDocument doc;
    doc["v"] = PROTOCOL_VERSION;
    if (id && id[0]) doc["id"] = id;
    doc["k"] = kind::pong;
    doc["t"] = t;
    doc["p"].to<JsonObject>();
    return detail::serialize_or_zero(doc, out, out_cap);
}

inline std::size_t encode_hello_ack(
    const char* id, uint64_t t,
    const char* board, const char* fw,
    const char* const* caps, std::size_t caps_n,
    const char* device_id,
    char* out, std::size_t out_cap) {
    JsonDocument doc;
    doc["v"] = PROTOCOL_VERSION;
    if (id && id[0]) doc["id"] = id;
    doc["k"] = kind::hello_ack;
    doc["t"] = t;
    JsonObject p = doc["p"].to<JsonObject>();
    p["board"] = board;
    p["fw"]    = fw;
    JsonArray  arr = p["caps"].to<JsonArray>();
    for (std::size_t i = 0; i < caps_n; ++i) arr.add(caps[i]);
    p["device_id"] = device_id;
    return detail::serialize_or_zero(doc, out, out_cap);
}

// Build a small screenshot.ack line (the error / no-data case). The success
// case is streamed directly by App (the raw frame is too big to hold as a
// std::string), so this only emits {ok:false, err} or a bare {ok}. `err` is a
// controlled constant and needs no JSON escaping.
inline std::string encode_screenshot_ack(const char* id, uint64_t t, bool ok, const char* err) {
  std::string s = "{\"v\":1";
  if (id && id[0]) { s += ",\"id\":\""; s += id; s += "\""; }
  s += ",\"k\":\""; s += kind::screenshot_ack; s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"ok\":";
  s += ok ? "true" : "false";
  if (!ok && err && err[0]) {
    s += ",\"err\":\""; s += err; s += "\"";
  }
  s += "}}";
  return s;
}

inline std::string encode_tap_ack(const char* id, uint64_t t, bool ok, const char* err) {
  std::string s = "{\"v\":1";
  if (id && id[0]) { s += ",\"id\":\""; s += id; s += "\""; }
  s += ",\"k\":\""; s += kind::tap_ack; s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"ok\":";
  s += ok ? "true" : "false";
  if (!ok && err && err[0]) {
    s += ",\"err\":\""; s += err; s += "\"";
  }
  s += "}}";
  return s;
}

inline std::string encode_focus_event_auto(uint64_t t) {
  std::string s = "{\"v\":1,\"k\":\"";
  s += kind::device_event;
  s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"kind\":\"focus\",\"target\":\"auto\"}}";
  return s;
}

inline std::string encode_focus_event_session(uint64_t t, const char* session_id) {
  std::string s = "{\"v\":1,\"k\":\"";
  s += kind::device_event;
  s += "\",\"t\":";
  s += std::to_string(t);
  s += ",\"p\":{\"kind\":\"focus\",\"target\":\"session\",\"sessionId\":\"";
  s += session_id ? session_id : "";
  s += "\"}}";
  return s;
}

}  // namespace m5proto
