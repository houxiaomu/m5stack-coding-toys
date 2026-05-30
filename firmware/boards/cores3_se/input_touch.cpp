#include "input_touch.h"

#include <M5Unified.h>

namespace m5board::cores3_se {

bool TouchInput::poll(m5hal::InputEvent& out) {
    M5.update();
    auto t = M5.Touch.getDetail();
    if (t.wasPressed()) {
        out.kind = m5hal::InputEvent::TouchTap;
        out.code = 0;
        out.x = static_cast<int16_t>(t.x);
        out.y = static_cast<int16_t>(t.y);
        out.t_ms = millis();
        return true;
    }
    return false;
}

}  // namespace m5board::cores3_se
