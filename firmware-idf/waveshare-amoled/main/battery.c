#include "battery.h"

#include "esp_log.h"

static const char *TAG = "batt";

#define AXP2101_ADDR 0x34
#define AXP_REG_STATUS2 0x01 // PMU status 2: bits[6:5] charge direction
#define AXP_REG_SOC 0xA4     // fuel-gauge state-of-charge, 0..100

static i2c_master_dev_handle_t s_dev;

static bool rd(uint8_t reg, uint8_t *val) {
    return i2c_master_transmit_receive(s_dev, &reg, 1, val, 1, 100) == ESP_OK;
}

bool battery_init(i2c_master_bus_handle_t bus) {
    i2c_device_config_t dc = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = AXP2101_ADDR,
        .scl_speed_hz = 100000,
    };
    if (i2c_master_bus_add_device(bus, &dc, &s_dev) != ESP_OK) {
        ESP_LOGW(TAG, "AXP2101 not on bus; battery disabled");
        s_dev = NULL;
        return false;
    }
    return true;
}

bool battery_read(int *pct_out, bool *charging_out) {
    if (!s_dev) return false;

    uint8_t soc;
    if (!rd(AXP_REG_SOC, &soc) || soc > 100) return false; // no cell / gauge cold

    uint8_t st2 = 0;
    rd(AXP_REG_STATUS2, &st2);
    // bits[6:5]: 00 standby, 01 charging, 10 discharging.
    bool charging = ((st2 >> 5) & 0x3) == 0x1;

    if (pct_out) *pct_out = soc;
    if (charging_out) *charging_out = charging;
    return true;
}
