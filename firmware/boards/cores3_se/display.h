#pragma once
#include "m5hal.h"

namespace m5board::cores3_se {

class CoresS3Display : public m5hal::Display {
public:
    void clear() override;
    void drawText(int x, int y, const char* utf8, uint8_t size) override;
    void drawIcon(int /*x*/, int /*y*/, m5hal::IconId /*id*/) override {}
    void fillRect(int x, int y, int w, int h, uint32_t rgb) override;
    void push() override;
    void setBrightness(uint8_t pct) override;
    int  width()  const override;
    int  height() const override;
};

}  // namespace m5board::cores3_se
