#pragma once
#include "m5hal.h"

namespace m5board::cardputer_adv {

// M3: keyboard hardware reported but poll() is a stub. M5 will wire real
// keyboard reads via M5Cardputer (or direct I2C). HAL contract: hasKeyboard()
// is about hardware presence; events are separate.
class CardputerKeyboardInput : public m5hal::Input {
public:
    bool poll(m5hal::InputEvent& /*out*/) override { return false; }
    bool hasKeyboard() const override { return true; }
    bool hasTouch() const override    { return false; }
};

}  // namespace m5board::cardputer_adv
