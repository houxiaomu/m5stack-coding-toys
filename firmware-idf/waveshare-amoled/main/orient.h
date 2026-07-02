#pragma once

#include <stdbool.h>

#include "driver/i2c_master.h"
#include "esp_lcd_touch.h"
#include "lvgl.h"

// Gravity-based 180° auto-rotation: polls the QMI8658 accelerometer and, when
// the board is held upside-down, flips both the display output and the touch
// coordinate mapping. Returns false (feature disabled, everything else keeps
// working) if the IMU is absent.
bool orient_init(i2c_master_bus_handle_t bus, lv_display_t *disp, esp_lcd_touch_handle_t tp);
