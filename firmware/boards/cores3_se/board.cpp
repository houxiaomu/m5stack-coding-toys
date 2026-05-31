#include "m5hal.h"

#include <M5Unified.h>
#include <cstring>

#include "device_id.h"
#include "display.h"
#include "input_touch.h"
#include "power_axp2101.h"
#include "transport_ble.h"
#include "transport_mux.h"
#include "transport_serial.h"

namespace m5hal {

namespace {
m5board::cores3_se::CoresS3Display  g_display;
m5board::cores3_se::TouchInput      g_input;
m5board::cores3_se::Axp2101Power    g_power;
m5board::cores3_se::SerialTransport g_serial;
m5board::cores3_se::BleGattTransport g_ble;
m5hal::TransportMux                  g_transport(&g_serial, &g_ble);
char                                g_device_id[24] = "";
bool startBlePairing(uint32_t nowMs) { return g_ble.startPairing(nowMs); }
bool stopBlePairing() { return g_ble.stopPairing(); }
bool blePairingActive() { return g_ble.pairingActive(); }
const char* blePairCode() { return g_ble.pairCode(); }
Board g_board{
    /* display   */ &g_display,
    /* input     */ &g_input,
    /* power     */ &g_power,
    /* transport */ &g_transport,
    /* name      */ "cores3-se",
    /* fw_ver    */ "0.5.0",
    /* device_id */ g_device_id,
    /* start_ble_pairing */ startBlePairing,
    /* stop_ble_pairing  */ stopBlePairing,
    /* ble_pairing_active */ blePairingActive,
    /* ble_pair_code */ blePairCode,
};
}  // namespace

Board* create_board() {
    auto cfg = M5.config();
    M5.begin(cfg);
    std::string id = formatDeviceId("M5SE", static_cast<uint32_t>(ESP.getEfuseMac()));
    std::strncpy(g_device_id, id.c_str(), sizeof(g_device_id) - 1);
    g_device_id[sizeof(g_device_id) - 1] = '\0';
    g_ble.configure(g_board.name, g_board.fw_ver, g_device_id);
    return &g_board;
}

}  // namespace m5hal
