#pragma once
#include "m5hal.h"

namespace m5board::cores3_se {

class TouchInput : public m5hal::Input {
public:
    bool poll(m5hal::InputEvent& out) override;
    bool hasKeyboard() const override { return false; }
    bool hasTouch() const override    { return true; }

private:
    bool pressing_ = false;
    bool long_sent_ = false;
    uint32_t press_start_ms_ = 0;
    int16_t press_x_ = 0;
    int16_t press_y_ = 0;
};

}  // namespace m5board::cores3_se
