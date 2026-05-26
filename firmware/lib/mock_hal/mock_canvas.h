#pragma once
#include "canvas.h"

#include <string>
#include <vector>

namespace m5render {

// MockCanvas records every primitive call as a string into a vector so pages
// can be unit-tested on the native env with no hardware. Calls are recorded
// in the form "<prim>" or "<prim>:<arg>" (e.g. "text:CONTEXT", "microBar:47",
// "fillRoundRect"). width()=320 height()=240.
class MockCanvas : public Canvas {
public:
  std::vector<std::string> calls;

  int width() const override { return 320; }
  int height() const override { return 240; }

  void begin() override { calls.push_back("begin"); }
  void end() override { calls.push_back("end"); }

  void fillScreen(uint16_t) override { calls.push_back("fillScreen"); }
  void fillRoundRect(int, int, int, int, int, uint16_t) override { calls.push_back("fillRoundRect"); }
  void drawRoundRect(int, int, int, int, int, uint16_t) override { calls.push_back("drawRoundRect"); }
  void fillCircle(int, int, int, uint16_t) override { calls.push_back("fillCircle"); }
  void drawCircle(int, int, int, uint16_t) override { calls.push_back("drawCircle"); }
  void drawHLine(int, int, int, uint16_t) override { calls.push_back("drawHLine"); }

  void microBar(int, int, int, int, int pct, uint16_t) override {
    calls.push_back("microBar:" + std::to_string(pct));
  }
  void sparkline(int, int, int, int, const float*, int n, uint16_t) override {
    calls.push_back("sparkline:" + std::to_string(n));
  }

  void text(const char* s, int, int, Font, Align, uint16_t) override {
    calls.push_back(std::string("text:") + (s ? s : ""));
  }
  int measureText(const char* s, Font) override {
    // Deterministic stub: 6 px/char so layout math in pages stays exercised.
    int n = 0; if (s) while (s[n]) ++n;
    return n * 6;
  }

  // Canned 2×2 RGB565 frame (8 bytes) so test_app can assert the capture path.
  // base64("\x12\x34\x56\x78\x9a\xbc\xde\xf0") == "EjRWeJq83vA=".
  bool rawFrame(const uint8_t** data, std::size_t* len, int* w, int* h, const char** fmt) override {
    static const uint8_t buf[8] = {0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0};
    calls.push_back("rawFrame");
    *data = buf;
    *len = sizeof(buf);
    *w = 2;
    *h = 2;
    *fmt = "rgb565";
    return true;
  }

  // ── query helpers ─────────────────────────────────────────────────────────

  // True if "<prim>:<arg>" was recorded exactly.
  bool called(const char* prim, const char* arg) const {
    std::string want = std::string(prim) + ":" + (arg ? arg : "");
    for (const auto& c : calls) if (c == want) return true;
    return false;
  }

  // True if any call begins with "<prim>" (either bare or "<prim>:...").
  bool calledPrefix(const char* prim) const {
    std::string p(prim);
    for (const auto& c : calls) {
      if (c == p) return true;
      if (c.size() > p.size() && c.compare(0, p.size(), p) == 0 && c[p.size()] == ':') return true;
    }
    return false;
  }

  // Count of calls beginning with "<prim>".
  int countPrefix(const char* prim) const {
    std::string p(prim);
    int n = 0;
    for (const auto& c : calls) {
      if (c == p) ++n;
      else if (c.size() > p.size() && c.compare(0, p.size(), p) == 0 && c[p.size()] == ':') ++n;
    }
    return n;
  }
};

}  // namespace m5render
