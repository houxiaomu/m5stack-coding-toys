#include "power_axp2101.h"

#include <M5Unified.h>

namespace m5board::cores3_se {

uint8_t Axp2101Power::batteryPct() {
    int8_t pct = M5.Power.getBatteryLevel();
    if (pct < 0) return 0;
    if (pct > 100) return 100;
    return static_cast<uint8_t>(pct);
}

bool Axp2101Power::charging() {
    return M5.Power.isCharging();
}

}  // namespace m5board::cores3_se
