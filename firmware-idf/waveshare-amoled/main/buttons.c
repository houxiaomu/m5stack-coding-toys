#include "buttons.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "ui.h"

#define BOOT_GPIO       GPIO_NUM_0
#define BTN_POLL_US     (30 * 1000) // 30 ms
#define BTN_LONG_MS     600         // >= this held = long press
#define BTN_DEBOUNCE_MS 40          // shorter than this on release = bounce

static const char *TAG = "btn";

static int64_t s_press_start_ms = -1; // -1 = currently released
static bool s_long_fired = false;     // long action already fired this hold

// Polled on an esp_timer (not the LVGL task). Classifies BOOT presses and calls
// the cross-task-safe ui_picker_* entries. Long fires while still held so a
// confirm feels immediate; short fires on release.
static void poll_cb(void *arg) {
    (void)arg;
    int64_t now = esp_timer_get_time() / 1000;
    bool down = (gpio_get_level(BOOT_GPIO) == 0); // active-low (external pull-up)

    if (down && s_press_start_ms < 0) {
        s_press_start_ms = now; // press edge
        s_long_fired = false;
    } else if (down && s_press_start_ms >= 0) {
        if (!s_long_fired && (now - s_press_start_ms) >= BTN_LONG_MS) {
            s_long_fired = true;
            ui_picker_confirm();
        }
    } else if (!down && s_press_start_ms >= 0) {
        int64_t held = now - s_press_start_ms;
        s_press_start_ms = -1; // release edge
        if (held < BTN_DEBOUNCE_MS) return;
        if (!s_long_fired && held < BTN_LONG_MS) ui_picker_short();
    }
}

void buttons_start(void) {
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << BOOT_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io);

    const esp_timer_create_args_t a = {.callback = poll_cb, .name = "btn"};
    esp_timer_handle_t t;
    if (esp_timer_create(&a, &t) == ESP_OK)
        esp_timer_start_periodic(t, BTN_POLL_US);
    ESP_LOGI(TAG, "BOOT button poller started");
}
