#pragma once

#include <M5Unified.h>

#include <cstddef>

#include "canvas.h"

namespace m5render {

// CoreS3 / CoreS3-SE Canvas implementation over M5GFX. Draws into an off-screen
// M5Canvas sprite (PSRAM-backed double buffer); end() pushes once to the LCD so
// frames appear without flicker. Maps semantic Font tiers to concrete M5GFX
// fonts and Align values to M5GFX text datums.
class CoreS3Canvas : public Canvas {
public:
    CoreS3Canvas();

    int width() const override;
    int height() const override;

    void begin() override;
    void end() override;

    void fillScreen(uint16_t c) override;
    void fillRoundRect(int x, int y, int w, int h, int r, uint16_t c) override;
    void drawRoundRect(int x, int y, int w, int h, int r, uint16_t c) override;
    void fillCircle(int x, int y, int r, uint16_t c) override;
    void drawCircle(int x, int y, int r, uint16_t c) override;
    void drawHLine(int x, int y, int w, uint16_t c) override;

    void microBar(int x, int y, int w, int h, int pct, uint16_t fg) override;
    void sparkline(int x, int y, int w, int h, const float* vals, int n, uint16_t c) override;

    void text(const char* s, int x, int y, Font f, Align a, uint16_t fg) override;
    int  measureText(const char* s, Font f) override;
    bool rawFrame(const uint8_t** data, std::size_t* len, int* w, int* h,
                  const char** fmt) override;

private:
    M5Canvas sprite_;
    bool     ready_ = false;  // true if the off-screen sprite allocated OK
};

}  // namespace m5render
