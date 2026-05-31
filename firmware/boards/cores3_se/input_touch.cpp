#include "input_touch.h"

#include <M5Unified.h>

namespace m5board::cores3_se {

bool TouchInput::poll(m5hal::InputEvent& out) {
    M5.update();
    auto t = M5.Touch.getDetail();
    const uint32_t now = millis();
    if (t.wasPressed()) {
        pressing_ = true;
        long_sent_ = false;
        press_start_ms_ = now;
        press_x_ = static_cast<int16_t>(t.x);
        press_y_ = static_cast<int16_t>(t.y);
        out.kind = m5hal::InputEvent::TouchTap;
        out.code = 0;
        out.x = static_cast<int16_t>(t.x);
        out.y = static_cast<int16_t>(t.y);
        out.t_ms = now;
        return true;
    }
    if (pressing_ && !long_sent_ && t.isPressed() && now - press_start_ms_ >= 2000) {
        long_sent_ = true;
        out.kind = m5hal::InputEvent::TouchLongPress;
        out.code = 0;
        out.x = press_x_;
        out.y = press_y_;
        out.t_ms = now;
        return true;
    }
    if (t.wasReleased()) pressing_ = false;
    return false;
}

}  // namespace m5board::cores3_se
