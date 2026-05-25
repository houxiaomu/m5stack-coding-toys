#include "power.h"

#include <M5Unified.h>

namespace m5board::cardputer_adv {

uint8_t CardputerPower::batteryPct() {
    int8_t pct = M5.Power.getBatteryLevel();
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return static_cast<uint8_t>(pct);
}

bool CardputerPower::charging() {
    return M5.Power.isCharging();
}

}  // namespace m5board::cardputer_adv
