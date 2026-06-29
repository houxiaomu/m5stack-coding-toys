// PWR physical button + power-save state. The PWR key is wired to the AXP2101
// PMIC's PWRON pin (not an ESP GPIO), so it's read by polling the PMIC IRQ
// status over I2C. Short press toggles sleep (panel off + radio parked), long
// press soft-powers-off. Also auto-sleeps after an idle timeout. See power.c.
#pragma once

#include "driver/i2c_master.h"
#include "esp_lcd_panel_ops.h"

void power_init(i2c_master_bus_handle_t bus, esp_lcd_panel_handle_t panel);
void power_toggle_sleep(void);
void power_shutdown(void);
bool power_is_asleep(void);
