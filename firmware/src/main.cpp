#ifndef BOARD_MOCK
#include <Arduino.h>

#include "app.h"
#include "canvas_m5gfx.h"  // CoreS3 canvas; board dir injected via build_src_filter
#include "m5hal.h"

namespace {
m5hal::Board*           g_board  = nullptr;
m5render::CoreS3Canvas* g_canvas = nullptr;
m5render::App*          g_app    = nullptr;
}  // namespace

void setup() {
    g_board = m5hal::create_board();
    delay(2000);  // let USB CDC enumerate (per bring-up notes)
    g_canvas = new m5render::CoreS3Canvas();
    g_app    = new m5render::App(*g_canvas, g_board);
    g_app->boot();
}

void loop() {
    g_app->tick();
    delay(5);
}
#else
int main() {
    return 0;
}
#endif
