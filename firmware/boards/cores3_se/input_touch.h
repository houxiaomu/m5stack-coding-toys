#pragma once
#include "m5hal.h"

namespace m5board::cores3_se {

class TouchInput : public m5hal::Input {
public:
    bool poll(m5hal::InputEvent& out) override;
    bool hasKeyboard() const override { return false; }
    bool hasTouch() const override    { return true; }
};

}  // namespace m5board::cores3_se
