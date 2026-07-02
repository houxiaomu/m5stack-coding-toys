#include <stdio.h>
#include <string.h>
#include <time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "esp_log.h"

#include "esp_timer.h"

#include "bsp/esp-bsp.h"
#include "bsp/display.h"
#include "bsp/touch.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lv_adapter.h"

#include "battery.h"
#include "buttons.h"
#include "model.h"
#include "orient.h"
#include "power.h"
#include "proto.h"
#include "ui.h"

static const char *TAG = "m5sb";

// Display/touch bring-up — mirrors the proven Waveshare BSP profile (50-line
// partial buffer in PSRAM; full-frame would exceed the QSPI DMA budget).
static lv_display_t *display_start(esp_lcd_panel_handle_t *panel_out,
                                   esp_lcd_touch_handle_t *tp_out) {
    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_io_handle_t io = NULL;
    bsp_display_config_t bcfg = {
        .max_transfer_sz = BSP_LCD_H_RES * BSP_LCD_V_RES * 2,
    };
    ESP_ERROR_CHECK(bsp_display_new(&bcfg, &panel, &io));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    esp_lv_adapter_config_t acfg = ESP_LV_ADAPTER_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(esp_lv_adapter_init(&acfg));

    esp_lv_adapter_display_config_t dcfg = {
        .panel = panel,
        .panel_io = io,
        .profile = {
            .interface = ESP_LV_ADAPTER_PANEL_IF_OTHER,
            .rotation = ESP_LV_ADAPTER_ROTATE_0,
            .hor_res = BSP_LCD_H_RES,
            .ver_res = BSP_LCD_V_RES,
            .buffer_height = 50,
            .use_psram = true,
            .enable_ppa_accel = false,
            .require_double_buffer = true,
        },
    };
    lv_display_t *disp = esp_lv_adapter_register_display(&dcfg);
    assert(disp);

    esp_lcd_touch_handle_t tp = NULL;
    bsp_display_cfg_t bsp_touch_cfg = {
        .touch_flags = {.swap_xy = 0, .mirror_x = 1, .mirror_y = 1},
    };
    if (bsp_touch_new(&bsp_touch_cfg, &tp) == ESP_OK && tp) {
        esp_lv_adapter_touch_config_t tcfg = ESP_LV_ADAPTER_TOUCH_DEFAULT_CONFIG(disp, tp);
        esp_lv_adapter_register_touch(&tcfg);
    } else {
        ESP_LOGW(TAG, "touch init failed; UI will be display-only");
    }

    ESP_ERROR_CHECK(esp_lv_adapter_start());
    bsp_display_brightness_set(100);
    if (panel_out) *panel_out = panel;
    if (tp_out) *tp_out = tp;
    return disp;
}

// Poll the PMIC and publish into the shared model. Runs off an esp_timer, so
// no I2C happens on the LVGL task. Cheap enough to run every few seconds.
static void battery_poll(void *arg) {
    (void)arg;
    int pct = 0;
    bool charging = false;
    bool ok = battery_read(&pct, &charging);
    model_lock();
    bool changed = g_model.has_battery != ok || g_model.batt_pct != pct ||
                   g_model.batt_charging != charging;
    g_model.has_battery = ok;
    g_model.batt_pct = pct;
    g_model.batt_charging = charging;
    if (changed) g_model.dirty = true;
    model_unlock();
}

void app_main(void) {
    ESP_LOGI(TAG, "Waveshare round-AMOLED Claude statusbar starting");

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    model_init();

    ESP_ERROR_CHECK(bsp_i2c_init());
    battery_init(bsp_i2c_get_handle());

    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_touch_handle_t tp = NULL;
    lv_display_t *disp = display_start(&panel, &tp);

    if (esp_lv_adapter_lock(-1) == ESP_OK) {
        ui_init();
        esp_lv_adapter_unlock();
    }

    // Gravity auto-rotate (QMI8658): flips display + touch when upside-down.
    orient_init(bsp_i2c_get_handle(), disp, tp);

    proto_start();

    // Physical buttons: PWR (AXP2101 PWRON) drives sleep/power-off + auto-sleep;
    // BOOT (GPIO0) drives the session picker.
    power_init(bsp_i2c_get_handle(), panel);
    buttons_start();

    battery_poll(NULL); // seed before the first paint
    const esp_timer_create_args_t bt_args = {.callback = battery_poll, .name = "batt"};
    esp_timer_handle_t bt;
    if (esp_timer_create(&bt_args, &bt) == ESP_OK)
        esp_timer_start_periodic(bt, 5 * 1000 * 1000); // 5 s

    ESP_LOGI(TAG, "init complete");
}
