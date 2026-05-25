#include "mock_hal.h"

namespace m5hal::mock {

static MockDisplay   g_display;
static MockInput     g_input;
static MockPower     g_power;
static MockTransport g_transport;

MockDisplay&   display()   { return g_display; }
MockTransport& transport() { return g_transport; }

static ::m5hal::Board g_board{
    &g_display, &g_input, &g_power, &g_transport, "mock", "0.0.0",
};

}  // namespace m5hal::mock

namespace m5hal {
Board* create_board() {
    return &::m5hal::mock::g_board;
}
}  // namespace m5hal
