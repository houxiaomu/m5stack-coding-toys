#include "canvas_m5gfx.h"

#include <cstdlib>
#include <vector>

namespace m5render {

CoreS3Canvas::CoreS3Canvas() : sprite_(&M5.Display) {
    M5.Display.setRotation(1);   // 320×240 landscape
    M5.Display.setBrightness(180);
    M5.Display.setTextWrap(false);

    sprite_.setColorDepth(16);
    sprite_.setPsram(true);  // prefer PSRAM for the 320×240×2B (~150KB) buffer
    void* p = sprite_.createSprite(M5.Display.width(), M5.Display.height());
    ready_ = (p != nullptr);
    if (ready_) sprite_.setTextWrap(false);
}

// When the sprite allocates, draw into it; otherwise fall back to drawing
// directly on the LCD so the device still shows *something*.
int CoreS3Canvas::width() const {
    return ready_ ? sprite_.width() : M5.Display.width();
}
int CoreS3Canvas::height() const {
    return ready_ ? sprite_.height() : M5.Display.height();
}

void CoreS3Canvas::begin() {
    // Back buffer; the active page clears it via fillScreen(). No-op here.
}
void CoreS3Canvas::end() {
    if (ready_) sprite_.pushSprite(0, 0);  // single flush — no flicker
}

void CoreS3Canvas::fillScreen(uint16_t c) {
    if (ready_) sprite_.fillScreen(c); else M5.Display.fillScreen(c);
}
void CoreS3Canvas::fillRoundRect(int x, int y, int w, int h, int r, uint16_t c) {
    if (ready_) sprite_.fillRoundRect(x, y, w, h, r, c);
    else        M5.Display.fillRoundRect(x, y, w, h, r, c);
}
void CoreS3Canvas::drawRoundRect(int x, int y, int w, int h, int r, uint16_t c) {
    if (ready_) sprite_.drawRoundRect(x, y, w, h, r, c);
    else        M5.Display.drawRoundRect(x, y, w, h, r, c);
}
void CoreS3Canvas::fillCircle(int x, int y, int r, uint16_t c) {
    if (ready_) sprite_.fillCircle(x, y, r, c); else M5.Display.fillCircle(x, y, r, c);
}
void CoreS3Canvas::drawCircle(int x, int y, int r, uint16_t c) {
    if (ready_) sprite_.drawCircle(x, y, r, c); else M5.Display.drawCircle(x, y, r, c);
}
void CoreS3Canvas::drawHLine(int x, int y, int w, uint16_t c) {
    if (ready_) sprite_.drawFastHLine(x, y, w, c); else M5.Display.drawFastHLine(x, y, w, c);
}

void CoreS3Canvas::microBar(int x, int y, int w, int h, int pct, uint16_t fg) {
    int p = pct < 0 ? 0 : pct > 100 ? 100 : pct;
    int r = h / 2;
    fillRoundRect(x, y, w, h, r, color::hairline);  // track
    int fw = (w * p) / 100;
    if (fw > 0) fillRoundRect(x, y, fw, h, r, fg);   // fill
}

void CoreS3Canvas::sparkline(int x, int y, int w, int h, const float* v, int n, uint16_t c) {
    if (!v || n < 2) return;
    float mx = 0;
    for (int i = 0; i < n; ++i)
        if (v[i] > mx) mx = v[i];
    if (mx <= 0) mx = 1;
    for (int i = 1; i < n; ++i) {
        int x0 = x + (w * (i - 1)) / (n - 1);
        int x1 = x + (w * i) / (n - 1);
        int y0 = y + h - static_cast<int>(h * v[i - 1] / mx);
        int y1 = y + h - static_cast<int>(h * v[i] / mx);
        if (ready_) sprite_.drawLine(x0, y0, x1, y1, c);
        else        M5.Display.drawLine(x0, y0, x1, y1, c);
    }
}

// Map semantic font tiers → concrete M5GFX fonts for a 320×240 screen.
static const lgfx::IFont* fontFor(Font f) {
    switch (f) {
        case Font::BigNumber: return &fonts::FreeSerifBold18pt7b;
        case Font::Title:     return &fonts::FreeSansBold9pt7b;
        case Font::Body:      return &fonts::FreeSerifBold12pt7b;
        case Font::Label:     return &fonts::Font0;
        case Font::Mono:      return &fonts::Font0;
    }
    return &fonts::Font0;
}

static textdatum_t datumFor(Align a) {
    switch (a) {
        case Align::TopLeft:      return top_left;
        case Align::TopRight:     return top_right;
        case Align::MiddleLeft:   return middle_left;
        case Align::MiddleCenter: return middle_center;
        case Align::MiddleRight:  return middle_right;
    }
    return top_left;
}

void CoreS3Canvas::text(const char* s, int x, int y, Font f, Align a, uint16_t fg) {
    if (!s) return;
    const lgfx::IFont* font = fontFor(f);
    textdatum_t datum = datumFor(a);
    if (ready_) {
        sprite_.setFont(font);
        sprite_.setTextDatum(datum);
        sprite_.setTextColor(fg);  // transparent bg: paints over the sprite buffer
        sprite_.drawString(s, x, y);
    } else {
        M5.Display.setFont(font);
        M5.Display.setTextDatum(datum);
        M5.Display.setTextColor(fg);
        M5.Display.drawString(s, x, y);
    }
}

int CoreS3Canvas::measureText(const char* s, Font f) {
    if (!s) return 0;
    if (ready_) { sprite_.setFont(fontFor(f)); return sprite_.textWidth(s); }
    M5.Display.setFont(fontFor(f));
    return M5.Display.textWidth(s);
}

bool CoreS3Canvas::capturePng(std::vector<uint8_t>& out) {
    if (!ready_) return false;
    std::size_t len = 0;
    void* png = sprite_.createPng(&len);  // M5GFX encodes the off-screen sprite
    if (!png || len == 0) {
        if (png) free(png);
        return false;
    }
    const uint8_t* p = static_cast<const uint8_t*>(png);
    out.assign(p, p + len);
    free(png);  // createPng returns a malloc'd buffer; caller frees
    return true;
}

}  // namespace m5render
