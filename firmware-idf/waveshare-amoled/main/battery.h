// On-device battery readout via the AXP2101 PMIC (I2C addr 0x34, gauge SOC in
// register 0xA4). Battery is the device's own — read here, not over the m5ct
// host link. Safe to call from a single poller task; not internally locked.
#pragma once

#include <stdbool.h>

#include "driver/i2c_master.h"

// Bind to the already-initialised BSP I2C bus. Returns false if the AXP2101
// can't be added to the bus (then battery_read always reports no battery).
bool battery_init(i2c_master_bus_handle_t bus);

// Read state-of-charge (0..100) and charging flag. Returns true on a valid
// reading (battery present), false otherwise (e.g. gauge not ready / no cell).
bool battery_read(int *pct_out, bool *charging_out);
