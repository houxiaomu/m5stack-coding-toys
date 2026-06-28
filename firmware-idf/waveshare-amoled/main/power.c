#include "power.h"

#include "bsp/esp-bsp.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "ble.h"
#include "model.h"

static const char *TAG = "pwr";

#define AXP2101_ADDR 0x34

// AXP2101 IRQ status register 2 (INTSTS2). PWRON (PEKEY) edge/press events latch
// here regardless of the enable mask; we write-1-to-clear. Bit layout (XPowersLib
// AXP2101): bit1 positive edge, bit2 negative edge, bit3 short press, bit4 long
// press. CONFIRMED on hardware via the calibration log below before trusting the
// shutdown path — if the dump shows different bits, fix these two masks.
#define AXP_REG_INTSTS2 0x49
#define AXP_PONS_MASK   0x08 // PWRON short press
#define AXP_PONL_MASK   0x10 // PWRON long press
#define AXP_REG_INTEN2  0x41 // IRQ enable register 2 (same bit layout)
#define AXP_REG_COMMON  0x10 // PMU common config; bit0 = soft power-off
#define AXP_SOFTOFF_BIT 0x01

// Set to 1 for the first hardware bring-up: logs every non-zero INTSTS2 so the
// short/long bits can be read off the monitor, and disables the shutdown path
// so a mislabelled bit can't power the board off mid-calibration.
#define AXP_CALIBRATE 0

#define POLL_US       (100 * 1000)         // 100 ms
#define AUTO_SLEEP_MS (10 * 60 * 1000)     // 10 min with no LIVE session

static i2c_master_dev_handle_t s_dev;
static esp_lcd_panel_handle_t s_panel;
static bool s_asleep;
static int64_t s_last_live_ms;

static bool axp_rd(uint8_t reg, uint8_t *v) {
    return s_dev && i2c_master_transmit_receive(s_dev, &reg, 1, v, 1, 100) == ESP_OK;
}
static bool axp_wr(uint8_t reg, uint8_t v) {
    uint8_t b[2] = {reg, v};
    return s_dev && i2c_master_transmit(s_dev, b, 2, 100) == ESP_OK;
}

bool power_is_asleep(void) { return s_asleep; }

static void enter_sleep(void) {
    if (s_asleep) return;
    s_asleep = true;
    bsp_display_brightness_set(0);
    if (s_panel) esp_lcd_panel_disp_on_off(s_panel, false);
    ble_suspend();
    ESP_LOGI(TAG, "sleep");
}

static void exit_sleep(void) {
    if (!s_asleep) return;
    s_asleep = false;
    if (s_panel) esp_lcd_panel_disp_on_off(s_panel, true);
    bsp_display_brightness_set(100);
    ble_resume();
    s_last_live_ms = esp_timer_get_time() / 1000; // restart the idle clock
    ESP_LOGI(TAG, "wake");
}

void power_toggle_sleep(void) {
    if (s_asleep) exit_sleep();
    else enter_sleep();
}

void power_shutdown(void) {
    uint8_t v = 0;
    axp_rd(AXP_REG_COMMON, &v);
    axp_wr(AXP_REG_COMMON, v | AXP_SOFTOFF_BIT);
}

static void poll_cb(void *arg) {
    (void)arg;
    int64_t now = esp_timer_get_time() / 1000;

    uint8_t sts = 0;
    if (axp_rd(AXP_REG_INTSTS2, &sts) && sts) {
#if AXP_CALIBRATE
        ESP_LOGI(TAG, "INTSTS2=0x%02x", sts);
        axp_wr(AXP_REG_INTSTS2, sts); // clear and observe; no actions
#else
        if (sts & AXP_PONL_MASK) {        // long press wins → power off
            axp_wr(AXP_REG_INTSTS2, sts); // write-1-clear
            power_shutdown();
            return;
        }
        if (sts & AXP_PONS_MASK) {        // short press → toggle sleep
            axp_wr(AXP_REG_INTSTS2, sts);
            power_toggle_sleep();
        } else {
            axp_wr(AXP_REG_INTSTS2, sts); // clear unrelated latched bits
        }
#endif
    }

    // Auto-sleep after AUTO_SLEEP_MS with no active Claude (LIVE) session.
    model_lock();
    bool live = (g_model.link == LINK_LIVE);
    model_unlock();
    if (live) s_last_live_ms = now;
    else if (!s_asleep && (now - s_last_live_ms) >= AUTO_SLEEP_MS)
        enter_sleep();
}

void power_init(i2c_master_bus_handle_t bus, esp_lcd_panel_handle_t panel) {
    s_panel = panel;
    s_last_live_ms = esp_timer_get_time() / 1000;

    i2c_device_config_t dc = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = AXP2101_ADDR,
        .scl_speed_hz = 100000,
    };
    if (i2c_master_bus_add_device(bus, &dc, &s_dev) != ESP_OK) {
        ESP_LOGW(TAG, "AXP2101 not on bus; PWR button disabled");
        s_dev = NULL;
        return;
    }

    // Enable PWRON short + long press IRQs and clear anything latched from boot.
    uint8_t en = 0;
    axp_rd(AXP_REG_INTEN2, &en);
    axp_wr(AXP_REG_INTEN2, en | AXP_PONS_MASK | AXP_PONL_MASK);
    uint8_t sts = 0;
    if (axp_rd(AXP_REG_INTSTS2, &sts) && sts) axp_wr(AXP_REG_INTSTS2, sts);

    const esp_timer_create_args_t a = {.callback = poll_cb, .name = "pwr"};
    esp_timer_handle_t t;
    if (esp_timer_create(&a, &t) == ESP_OK)
        esp_timer_start_periodic(t, POLL_US);
    ESP_LOGI(TAG, "power/PWRON poller started");
}
