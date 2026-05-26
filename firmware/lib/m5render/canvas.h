#pragma once
#include <cstddef>
#include <cstdint>

namespace m5render {

// RGB565 packing (8-8-8 → 5-6-5), shared by all device canvases.
constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// Anthropic warm-beige palette (from handoff prototype).
namespace color {
  constexpr uint16_t bg       = rgb565(0xEB, 0xE6, 0xDA);
  constexpr uint16_t card     = rgb565(0xF4, 0xF0, 0xE5);
  constexpr uint16_t cardLine = rgb565(0xD8, 0xD1, 0xBD);
  constexpr uint16_t ink      = rgb565(0x1F, 0x1E, 0x1B);
  constexpr uint16_t ink2     = rgb565(0x40, 0x3D, 0x38);
  constexpr uint16_t mute     = rgb565(0x8A, 0x84, 0x7A);
  constexpr uint16_t accent   = rgb565(0xD9, 0x77, 0x57);
  constexpr uint16_t accSoft  = rgb565(0xF2, 0xD5, 0xC0);
  constexpr uint16_t good     = rgb565(0x3F, 0x7D, 0x62);
  constexpr uint16_t warn     = rgb565(0xC2, 0x54, 0x50);
  constexpr uint16_t hairline = rgb565(0xE2, 0xDD, 0xCE);
}

// Semantic font tiers — each device maps these to concrete fonts/sizes.
enum class Font : uint8_t { BigNumber, Title, Body, Label, Mono };

// Text alignment (datum).
enum class Align : uint8_t { TopLeft, TopRight, MiddleLeft, MiddleCenter, MiddleRight };

// Device-agnostic drawing surface. Implementations render into an off-screen
// buffer; the app calls begin()/end() around a frame and end() flushes once.
class Canvas {
public:
  virtual ~Canvas() = default;

  virtual int width() const = 0;
  virtual int height() const = 0;

  virtual void begin() = 0;                 // start a frame (clear back buffer)
  virtual void end() = 0;                   // flush back buffer to screen (one push)

  virtual void fillScreen(uint16_t c) = 0;
  virtual void fillRoundRect(int x, int y, int w, int h, int r, uint16_t c) = 0;
  virtual void drawRoundRect(int x, int y, int w, int h, int r, uint16_t c) = 0;
  virtual void fillCircle(int x, int y, int r, uint16_t c) = 0;
  virtual void drawCircle(int x, int y, int r, uint16_t c) = 0;
  virtual void drawHLine(int x, int y, int w, uint16_t c) = 0;

  // Progress bar: rounded track + filled portion (pct clamped 0..100).
  virtual void microBar(int x, int y, int w, int h, int pct, uint16_t fg) = 0;
  // Polyline sparkline across [x,x+w]×[y,y+h], values normalized internally.
  virtual void sparkline(int x, int y, int w, int h, const float* vals, int n, uint16_t c) = 0;

  virtual void text(const char* s, int x, int y, Font f, Align a, uint16_t fg) = 0;
  virtual int  measureText(const char* s, Font f) = 0;

  // Expose the current frame's raw pixel buffer (no copy) for screen capture.
  // On success sets the out-params and returns true. PNG encoding is done
  // host-side — the device can't deflate a full frame in reasonable time — so
  // the app streams these raw bytes out. Default: unsupported.
  virtual bool rawFrame(const uint8_t** data, std::size_t* len, int* w, int* h, const char** fmt) {
    (void)data;
    (void)len;
    (void)w;
    (void)h;
    (void)fmt;
    return false;
  }
};

}  // namespace m5render
