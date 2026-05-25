#pragma once
#include "m5hal.h"

namespace m5board::cores3_se {

class Axp2101Power : public m5hal::Power {
public:
    uint8_t batteryPct() override;
    bool    charging() override;
};

}  // namespace m5board::cores3_se
