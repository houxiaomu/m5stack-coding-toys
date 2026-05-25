#pragma once
#include "m5hal.h"

namespace m5board::cardputer_adv {

class CardputerPower : public m5hal::Power {
public:
    uint8_t batteryPct() override;
    bool    charging() override;
};

}  // namespace m5board::cardputer_adv
