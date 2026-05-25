#include "display.h"

#include <M5Unified.h>

namespace m5board::cardputer_adv {

void CardputerDisplay::clear() {
    M5.Display.fillScreen(TFT_BLACK);
}

void CardputerDisplay::drawText(int x, int y, const char* utf8, uint8_t size) {
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    M5.Display.setTextSize(size);
    M5.Display.setCursor(x, y);
    M5.Display.print(utf8);
}

void CardputerDisplay::fillRect(int x, int y, int w, int h, uint32_t rgb) {
    uint8_t r = (rgb >> 16) & 0xff;
    uint8_t g = (rgb >> 8) & 0xff;
    uint8_t b = (rgb) & 0xff;
    uint16_t c565 = M5.Display.color565(r, g, b);
    M5.Display.fillRect(x, y, w, h, c565);
}

void CardputerDisplay::push() {
    // M5Unified paints directly.
}

void CardputerDisplay::setBrightness(uint8_t pct) {
    uint8_t v = static_cast<uint8_t>((static_cast<uint16_t>(pct) * 255) / 100);
    M5.Display.setBrightness(v);
}

int CardputerDisplay::width() const  { return M5.Display.width(); }
int CardputerDisplay::height() const { return M5.Display.height(); }

}  // namespace m5board::cardputer_adv
