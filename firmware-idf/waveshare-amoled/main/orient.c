#include "orient.h"

#include <stdlib.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_lv_adapter.h"

// For reading the adapter-installed flush_cb (LVGL 9 has a setter but no
// getter); the private header is LVGL's sanctioned escape hatch.
#include "src/display/lv_display_private.h"

// Temporary bring-up aid: overlays raw accel counts + flip state on the active
// screen so the chip-axis → UI-axis mapping can be read off an `m5ct
// screenshot`. Ship with 0.
#define ORIENT_DEBUG 0

static const char *TAG = "orient";

// ---------------------------------------------------------------- QMI8658 --
// Minimal accel-only driver. Register map per the QMI8658A datasheet (the
// board BSP header's I2C comment claims a QMA7981 — it is wrong, the bus scan
// shows a QMI8658 at 0x6B).
#define QMI8658_ADDR 0x6B
#define QMI_REG_WHO_AM_I 0x00 // reads 0x05
#define QMI_REG_CTRL1 0x02    // bit6 = address auto-increment for burst reads
#define QMI_REG_CTRL2 0x03    // accel: [6:4] full-scale, [3:0] ODR
#define QMI_REG_CTRL7 0x08    // bit0 = accel enable
#define QMI_REG_AX_L 0x35     // AX_L..AZ_H, 6 bytes, little-endian int16
#define QMI_REG_RESET 0x60    // write 0xB0 = soft reset
#define QMI_WHO_AM_I_VAL 0x05
#define QMI_CTRL2_2G_62HZ 0x07 // ±2 g, 62.5 Hz — 16384 LSB/g

// Which raw accel axis points toward the UI's physical "up" in the normal
// orientation (0=X 1=Y 2=Z, with sign). Read empirically off the ORIENT_DEBUG
// overlay with the board held upright: ax=-15151 ay=-481 az=4577, i.e. +X
// points at the UI bottom, so UI-up = -X.
#define ORIENT_UP_AXIS 0
#define ORIENT_UP_SIGN (-1)

// Flip only on a clear, sustained signal: the in-plane gravity component must
// exceed the dead zone (board lying flat keeps its current orientation) for
// FLIP_CONFIRM_POLLS consecutive polls (~1 s).
#define POLL_PERIOD_US (250 * 1000)
#define FLIP_THRESHOLD 5734 // 0.35 g in ±2 g counts
#define FLIP_CONFIRM_POLLS 4
// Lying flat can't be "upside-down": after a sustained stay in the dead zone
// revert to normal, so putting the board down from a flipped hold doesn't
// leave the desk view latched at 180°.
#define FLAT_REVERT_POLLS 12

static i2c_master_dev_handle_t s_dev;
static lv_display_t *s_disp;
static esp_lcd_touch_handle_t s_tp;
static lv_display_flush_cb_t s_orig_flush;
static volatile bool s_flipped;
static int s_pending_polls;
static int s_flat_polls;

#if ORIENT_DEBUG
static lv_obj_t *s_dbg_lbl;
#endif

static bool qmi_wr(uint8_t reg, uint8_t val) {
    uint8_t buf[2] = {reg, val};
    return i2c_master_transmit(s_dev, buf, 2, 100) == ESP_OK;
}

static bool qmi_rd(uint8_t reg, uint8_t *val, size_t len) {
    return i2c_master_transmit_receive(s_dev, &reg, 1, val, len, 100) == ESP_OK;
}

static bool qmi_read_accel(int16_t out[3]) {
    uint8_t raw[6];
    if (!qmi_rd(QMI_REG_AX_L, raw, sizeof(raw))) return false;
    for (int i = 0; i < 3; i++) out[i] = (int16_t)(raw[2 * i] | (raw[2 * i + 1] << 8));
    return true;
}

// ------------------------------------------------------------- 180° flush --
// The CO5300 has no MADCTL Y-mirror and the LVGL adapter refuses to rotate on
// panel interface OTHER, so flip in the narrowest layer we own: wrap the
// adapter's flush_cb. A 180° rotation of a partial band is just the pixel
// sequence reversed plus the area mirrored about the screen centre — and with
// an even resolution it preserves the even-x1/odd-x2 alignment the panel
// needs (ui.c's area_rounder_cb).
static void flip_flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map) {
    if (!s_flipped) {
        s_orig_flush(disp, area, px_map);
        return;
    }
    size_t n = (size_t)lv_area_get_width(area) * lv_area_get_height(area);
    uint16_t *p = (uint16_t *)px_map;
    for (size_t i = 0, j = n - 1; i < j; i++, j--) {
        uint16_t t = p[i];
        p[i] = p[j];
        p[j] = t;
    }
    const int32_t hres = lv_display_get_horizontal_resolution(disp);
    const int32_t vres = lv_display_get_vertical_resolution(disp);
    lv_area_t ra = {
        .x1 = hres - 1 - area->x2,
        .y1 = vres - 1 - area->y2,
        .x2 = hres - 1 - area->x1,
        .y2 = vres - 1 - area->y1,
    };
    s_orig_flush(disp, &ra, px_map);
}

static void apply_flip(bool flipped) {
    // Under the adapter lock: excludes the LVGL render/flush task, so a frame
    // never mixes pre- and post-flip band mappings, and the touch mirror
    // flags switch atomically with the repaint.
    if (esp_lv_adapter_lock(-1) != ESP_OK) return;
    s_flipped = flipped;
    if (s_tp) {
        // Normal orientation runs mirror_x=1/mirror_y=1 (app_main's touch
        // config); flipped is the complement.
        esp_lcd_touch_set_mirror_x(s_tp, !flipped);
        esp_lcd_touch_set_mirror_y(s_tp, !flipped);
    }
    lv_obj_invalidate(lv_display_get_screen_active(s_disp));
    lv_obj_invalidate(lv_display_get_layer_top(s_disp));
    lv_obj_invalidate(lv_display_get_layer_sys(s_disp));
    esp_lv_adapter_unlock();
    ESP_LOGI(TAG, "orientation -> %s", flipped ? "flipped" : "normal");
}

static void orient_poll(void *arg) {
    (void)arg;
    int16_t a[3];
    if (!qmi_read_accel(a)) return;

    int up = ORIENT_UP_SIGN * a[ORIENT_UP_AXIS];
    bool want;
    if (up > FLIP_THRESHOLD) {
        want = false;
    } else if (up < -FLIP_THRESHOLD) {
        want = true;
    } else {
        // Dead zone (lying flat): hold briefly, then settle back to normal.
        s_pending_polls = 0;
        if (++s_flat_polls >= FLAT_REVERT_POLLS) {
            s_flat_polls = 0;
            if (s_flipped) apply_flip(false);
        }
        goto dbg;
    }
    s_flat_polls = 0;

    if (want == s_flipped) {
        s_pending_polls = 0;
    } else if (++s_pending_polls >= FLIP_CONFIRM_POLLS) {
        s_pending_polls = 0;
        apply_flip(want);
    }

dbg:
#if ORIENT_DEBUG
    if (s_dbg_lbl && esp_lv_adapter_lock(-1) == ESP_OK) {
        lv_label_set_text_fmt(s_dbg_lbl, "%d %d %d F%d", a[0], a[1], a[2], (int)s_flipped);
        esp_lv_adapter_unlock();
    }
#else
    ;
#endif
}

bool orient_init(i2c_master_bus_handle_t bus, lv_display_t *disp, esp_lcd_touch_handle_t tp) {
    i2c_device_config_t dc = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = QMI8658_ADDR,
        .scl_speed_hz = 100000,
    };
    if (i2c_master_bus_add_device(bus, &dc, &s_dev) != ESP_OK) {
        ESP_LOGW(TAG, "QMI8658 not on bus; auto-rotate disabled");
        s_dev = NULL;
        return false;
    }

    qmi_wr(QMI_REG_RESET, 0xB0);
    vTaskDelay(pdMS_TO_TICKS(30));

    uint8_t who = 0;
    if (!qmi_rd(QMI_REG_WHO_AM_I, &who, 1) || who != QMI_WHO_AM_I_VAL) {
        ESP_LOGW(TAG, "QMI8658 WHO_AM_I=0x%02X (want 0x05); auto-rotate disabled", who);
        return false;
    }
    if (!qmi_wr(QMI_REG_CTRL1, 0x40) ||                // address auto-increment
        !qmi_wr(QMI_REG_CTRL2, QMI_CTRL2_2G_62HZ) ||   // accel ±2 g @ 62.5 Hz
        !qmi_wr(QMI_REG_CTRL7, 0x01)) {                // accel enable, gyro off
        ESP_LOGW(TAG, "QMI8658 config failed; auto-rotate disabled");
        return false;
    }

    s_disp = disp;
    s_tp = tp;

    if (esp_lv_adapter_lock(-1) != ESP_OK) return false;
    s_orig_flush = disp->flush_cb;
    lv_display_set_flush_cb(disp, flip_flush_cb);
#if ORIENT_DEBUG
    s_dbg_lbl = lv_label_create(lv_display_get_screen_active(disp));
    lv_obj_set_style_text_color(s_dbg_lbl, lv_color_white(), 0);
    lv_obj_align(s_dbg_lbl, LV_ALIGN_CENTER, 0, 120);
    lv_label_set_text(s_dbg_lbl, "orient?");
#endif
    esp_lv_adapter_unlock();

    const esp_timer_create_args_t targs = {.callback = orient_poll, .name = "orient"};
    esp_timer_handle_t t;
    if (esp_timer_create(&targs, &t) != ESP_OK) return false;
    esp_timer_start_periodic(t, POLL_PERIOD_US);
    ESP_LOGI(TAG, "QMI8658 up; gravity auto-rotate armed");
    return true;
}
