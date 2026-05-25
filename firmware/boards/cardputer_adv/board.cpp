#include "m5hal.h"

#include <M5Unified.h>

#include "display.h"
#include "input_keyboard.h"
#include "power.h"
#include "transport_serial.h"

namespace m5hal {

namespace {
m5board::cardputer_adv::CardputerDisplay      g_display;
m5board::cardputer_adv::CardputerKeyboardInput g_input;
m5board::cardputer_adv::CardputerPower         g_power;
m5board::cardputer_adv::SerialTransport        g_transport;
Board g_board{
    /* display   */ &g_display,
    /* input     */ &g_input,
    /* power     */ &g_power,
    /* transport */ &g_transport,
    /* name      */ "cardputer-adv",
    /* fw_ver    */ "0.3.0",
};
}  // namespace

Board* create_board() {
    auto cfg = M5.config();
    // Generic ESP32-S3 board.json doesn't know about Cardputer; tell M5Unified
    // to assume Cardputer if hardware auto-detection comes up empty.
    cfg.fallback_board = m5::board_t::board_M5Cardputer;
    M5.begin(cfg);
    return &g_board;
}

}  // namespace m5hal
