#include "m5hal.h"

#include <M5Unified.h>
#include <cstring>

#include "device_id.h"
#include "display.h"
#include "input_touch.h"
#include "power_axp2101.h"
#include "transport_serial.h"

namespace m5hal {

namespace {
m5board::cores3_se::CoresS3Display  g_display;
m5board::cores3_se::TouchInput      g_input;
m5board::cores3_se::Axp2101Power    g_power;
m5board::cores3_se::SerialTransport g_transport;
char                                g_device_id[24] = "";
Board g_board{
    /* display   */ &g_display,
    /* input     */ &g_input,
    /* power     */ &g_power,
    /* transport */ &g_transport,
    /* name      */ "cores3-se",
    /* fw_ver    */ "0.4.0",
    /* device_id */ g_device_id,
};
}  // namespace

Board* create_board() {
    auto cfg = M5.config();
    M5.begin(cfg);
    std::string id = formatDeviceId("M5SE", static_cast<uint32_t>(ESP.getEfuseMac()));
    std::strncpy(g_device_id, id.c_str(), sizeof(g_device_id) - 1);
    g_device_id[sizeof(g_device_id) - 1] = '\0';
    return &g_board;
}

}  // namespace m5hal
