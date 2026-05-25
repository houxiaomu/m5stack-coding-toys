#include "input_touch.h"

#include <M5Unified.h>

namespace m5board::cores3_se {

// Encode touch position as a region id in InputEvent.code:
//   0 = top half (used for "Allow"), 1 = bottom half (used for "Deny")
static uint16_t regionFor(int32_t y) {
    const int32_t mid = M5.Display.height() / 2;
    return y < mid ? 0 : 1;
}

bool TouchInput::poll(m5hal::InputEvent& out) {
    M5.update();
    auto t = M5.Touch.getDetail();
    if (t.wasPressed()) {
        out.kind = m5hal::InputEvent::TouchTap;
        out.code = regionFor(t.y);
        out.t_ms = millis();
        return true;
    }
    return false;
}

}  // namespace m5board::cores3_se
