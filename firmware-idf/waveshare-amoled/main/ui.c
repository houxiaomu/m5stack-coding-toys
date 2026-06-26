#include "ui.h"

#include <ctype.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "lvgl.h"
#include "bsp/esp-bsp.h"
#include "esp_heap_caps.h"
#include "esp_lv_adapter.h"
#include "esp_timer.h"

#include "model.h"
#include "proto.h"
#include "ble.h"

// ============================================================ design tokens ==
// Flat colour on true black. No gradients/shadows → no RGB565 banding.
#define COL_BG 0x000000
#define COL_WHITE 0xF1F5F9
#define COL_DIM 0x64748B
#define COL_BAR_TRACK 0x1E293B
#define COL_RING_TRACK 0x0E1626
#define COL_WORKING 0x22D3EE   // cyan
#define COL_AWAITING 0xF59E0B  // amber
#define COL_ATTENTION 0xEF4444 // red
#define COL_LINKED 0x22C55E    // green
#define COL_USAGE_LOW 0x38BDF8  // sky
#define COL_USAGE_MID 0xF59E0B  // amber
#define COL_USAGE_HIGH 0xEF4444 // red

// Display geometry (466x466 round panel).
#define DISP_SIZE 466
#define RING_BOX 458       // arc bounding box, just inside the bezel
#define RING_TRACK_W 3
#define RING_SEG_W 7
#define RING_SEG_DEG 64    // length of the working spinner segment
#define RING_SPIN_STEP 11  // degrees advanced per tick

// Spacing scale (used for flex gaps & margins — relative, not absolute coords).
#define GAP_TIGHT 2
#define GAP_SM 8
#define GAP_MD 16
#define GAP_LG 24

// Pill padding.
#define PILL_PAD_X 14
#define PILL_PAD_Y 5

// Usage bar row: [name][track][value].
#define BAR_TRACK_W 120
#define BAR_H 8
#define BAR_NAME_W 36
#define BAR_VALUE_W 48
#define BAR_COL_GAP 10
#define USAGE_WARN_PCT 60 // < warn → low colour
#define USAGE_HOT_PCT 85  // ≥ hot → high colour

// Sessions page rows.
#define SESS_ROW_W 280
#define SESS_ROW_H 32
#define SESS_DOT 12
#define SESS_NAME_W 210
#define SESS_RADIUS 16

// Notify overlay.
#define NOTIFY_RING_W 8
#define NOTIFY_TEXT_W 320

// Pairing screen.
#define PAIR_CODE_TRACKING 6    // letter spacing for the 6-digit code

// Behaviour.
#define TICK_MS 80              // UI repaint / animation tick
#define NOTIFY_AUTO_MS 8000     // low/normal notify auto-dismiss
#define BRIGHT_IDLE 35
#define BRIGHT_ACTIVE 100
#define MIN_RING_OPA 70
#define CALM_RING_OPA 150
#define PULSE_RING_BASE 120
#define PULSE_RING_SPAN 135

#define N_BARS 3
enum { BAR_CTX = 0, BAR_BLOCK, BAR_WEEK };
static const char *BAR_LABELS[N_BARS] = {"CTX", "5H", "WK"};

typedef enum { PAGE_LIVE = 0, PAGE_SESSIONS } page_t;

// ============================================================ widget handles ==
static lv_obj_t *scr;
static lv_obj_t *ring;
// live page
static lv_obj_t *live_page, *model_pill, *model_lbl, *activity_lbl;
static lv_obj_t *metric_big, *metric_sub, *git_lbl;
static lv_obj_t *bar_fill[N_BARS], *bar_val[N_BARS];
// idle page
static lv_obj_t *idle_page, *clock_lbl, *date_lbl, *idle_pill, *idle_pill_lbl;
// sessions page
static lv_obj_t *sess_page, *sess_row[MODEL_MAX_SESSIONS], *sess_dot[MODEL_MAX_SESSIONS],
    *sess_name[MODEL_MAX_SESSIONS];
// notify page
static lv_obj_t *notify_page, *notify_ring, *notify_title, *notify_body;
// pairing page
static lv_obj_t *pair_page, *pair_code_lbl;

static page_t s_page = PAGE_LIVE;
static int s_spin = 0;
static float s_pulse = 0;
static char s_row_id[MODEL_MAX_SESSIONS][24];

static void tick_cb(lv_timer_t *t);

// ================================================================== helpers ==
static void set_hidden(lv_obj_t *o, bool hide) {
    if (!o) return;
    if (hide) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
}

static uint32_t activity_color(activity_t a) {
    switch (a) {
        case ACT_WORKING: return COL_WORKING;
        case ACT_AWAITING: return COL_AWAITING;
        case ACT_ATTENTION: return COL_ATTENTION;
        default: return COL_LINKED;
    }
}

static const char *activity_text(activity_t a) {
    switch (a) {
        case ACT_WORKING: return "WORKING";
        case ACT_AWAITING: return "AWAITING INPUT";
        case ACT_ATTENTION: return "NEEDS ATTENTION";
        default: return "ACTIVE";
    }
}

static uint32_t usage_color(int pct) {
    return pct < USAGE_WARN_PCT ? COL_USAGE_LOW
                                : (pct < USAGE_HOT_PCT ? COL_USAGE_MID : COL_USAGE_HIGH);
}

static void label_set(lv_obj_t *l, const lv_font_t *font, uint32_t color) {
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
}

// A full-screen, transparent, non-scrolling flex-column page centred on screen.
static lv_obj_t *make_page(int gap) {
    lv_obj_t *p = lv_obj_create(scr);
    lv_obj_remove_style_all(p);
    lv_obj_set_size(p, DISP_SIZE, DISP_SIZE);
    lv_obj_center(p);
    lv_obj_remove_flag(p, LV_OBJ_FLAG_SCROLLABLE);
    // Transparent to touch so taps/long-presses fall through to the screen.
    lv_obj_remove_flag(p, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_flex_flow(p, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(p, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(p, gap, 0);
    return p;
}

static lv_obj_t *make_pill(lv_obj_t *parent, uint32_t bg) {
    lv_obj_t *p = lv_obj_create(parent);
    lv_obj_remove_style_all(p);
    lv_obj_remove_flag(p, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(p, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_style_radius(p, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(p, lv_color_hex(bg), 0);
    lv_obj_set_style_bg_opa(p, LV_OPA_30, 0);
    lv_obj_set_style_pad_hor(p, PILL_PAD_X, 0);
    lv_obj_set_style_pad_ver(p, PILL_PAD_Y, 0);
    return p;
}

// ================================================================== events ==
// Core screen-tap behaviour: dismiss an active notify, else flip between the
// live dashboard and the session list. Shared by the physical touch handler
// and the host `tap` RPC. Only touches g_model (mutexed) and s_page (an int the
// LVGL tick reads), so it is safe to call from the protocol task.
void ui_tap(void) {
    model_lock();
    bool notif = g_model.notify_active;
    bool multi = (g_model.link == LINK_LIVE && g_model.session_count > 1);
    if (notif) {
        g_model.notify_active = false;
        g_model.dirty = true;
    }
    model_unlock();
    if (notif) return;
    if (multi) s_page = (s_page == PAGE_LIVE) ? PAGE_SESSIONS : PAGE_LIVE;
}

static void on_scr_click(lv_event_t *e) {
    (void)e;
    ui_tap();
}

// Long-press anywhere toggles BLE pairing mode (mirrors CoreS3's gesture).
static void on_scr_long_press(lv_event_t *e) {
    (void)e;
    ble_toggle_pairing(esp_timer_get_time() / 1000);
}

static void on_row_click(lv_event_t *e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    if (idx >= 0 && idx < MODEL_MAX_SESSIONS && s_row_id[idx][0]) {
        proto_send_focus(s_row_id[idx]);
    }
}

// =================================================================== build ==
static void build_ring(void) {
    ring = lv_arc_create(scr);
    lv_obj_set_size(ring, RING_BOX, RING_BOX);
    lv_obj_center(ring);
    lv_arc_set_bg_angles(ring, 0, 360);
    lv_arc_set_angles(ring, 0, RING_SEG_DEG);
    lv_obj_remove_flag(ring, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(ring, RING_TRACK_W, LV_PART_MAIN);
    lv_obj_set_style_arc_color(ring, lv_color_hex(COL_RING_TRACK), LV_PART_MAIN);
    lv_obj_set_style_arc_width(ring, RING_SEG_W, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(ring, lv_color_hex(COL_WORKING), LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(ring, true, LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(ring, LV_OPA_TRANSP, LV_PART_KNOB);
    lv_obj_set_style_pad_all(ring, 0, LV_PART_KNOB);
}

// One usage-bar row inside `parent`: right-aligned name, track+fill, value.
static void build_bar_row(lv_obj_t *parent, int i) {
    lv_obj_t *row = lv_obj_create(parent);
    lv_obj_remove_style_all(row);
    lv_obj_remove_flag(row, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(row, BAR_COL_GAP, 0);

    lv_obj_t *name = lv_label_create(row);
    label_set(name, &lv_font_montserrat_16, COL_DIM);
    lv_obj_set_width(name, BAR_NAME_W);
    lv_obj_set_style_text_align(name, LV_TEXT_ALIGN_RIGHT, 0);
    lv_label_set_text(name, BAR_LABELS[i]);

    lv_obj_t *track = lv_obj_create(row);
    lv_obj_remove_style_all(track);
    lv_obj_remove_flag(track, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(track, BAR_TRACK_W, BAR_H);
    lv_obj_set_style_radius(track, BAR_H / 2, 0);
    lv_obj_set_style_bg_color(track, lv_color_hex(COL_BAR_TRACK), 0);
    lv_obj_set_style_bg_opa(track, LV_OPA_COVER, 0);

    lv_obj_t *fill = lv_obj_create(track);
    lv_obj_remove_style_all(fill);
    lv_obj_remove_flag(fill, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(fill, 0, BAR_H);
    lv_obj_align(fill, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_set_style_radius(fill, BAR_H / 2, 0);
    lv_obj_set_style_bg_color(fill, lv_color_hex(COL_USAGE_LOW), 0);
    lv_obj_set_style_bg_opa(fill, LV_OPA_COVER, 0);
    bar_fill[i] = fill;

    lv_obj_t *val = lv_label_create(row);
    label_set(val, &lv_font_montserrat_16, COL_WHITE);
    lv_obj_set_width(val, BAR_VALUE_W);
    lv_obj_set_style_text_align(val, LV_TEXT_ALIGN_LEFT, 0);
    lv_label_set_text(val, "--");
    bar_val[i] = val;
}

static void build_live_page(void) {
    live_page = make_page(GAP_SM);

    model_pill = make_pill(live_page, COL_DIM);
    model_lbl = lv_label_create(model_pill);
    label_set(model_lbl, &lv_font_montserrat_20, COL_WHITE);
    lv_label_set_text(model_lbl, "Claude");

    activity_lbl = lv_label_create(live_page);
    label_set(activity_lbl, &lv_font_montserrat_24, COL_WORKING);
    lv_label_set_text(activity_lbl, "ACTIVE");

    metric_big = lv_label_create(live_page);
    label_set(metric_big, &lv_font_montserrat_48, COL_WHITE);
    lv_label_set_text(metric_big, "");

    metric_sub = lv_label_create(live_page);
    label_set(metric_sub, &lv_font_montserrat_16, COL_DIM);
    lv_label_set_text(metric_sub, "");

    lv_obj_t *bars = lv_obj_create(live_page);
    lv_obj_remove_style_all(bars);
    lv_obj_remove_flag(bars, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(bars, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(bars, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(bars, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(bars, GAP_SM, 0);
    lv_obj_set_style_margin_top(bars, GAP_MD, 0);
    for (int i = 0; i < N_BARS; i++) build_bar_row(bars, i);

    git_lbl = lv_label_create(live_page);
    label_set(git_lbl, &lv_font_montserrat_16, COL_DIM);
    lv_obj_set_style_margin_top(git_lbl, GAP_MD, 0);
    lv_label_set_text(git_lbl, "");
}

static void build_idle_page(void) {
    idle_page = make_page(GAP_MD);

    clock_lbl = lv_label_create(idle_page);
    label_set(clock_lbl, &lv_font_montserrat_48, COL_WHITE);
    lv_label_set_text(clock_lbl, "--:--");

    date_lbl = lv_label_create(idle_page);
    label_set(date_lbl, &lv_font_montserrat_20, COL_DIM);
    lv_label_set_text(date_lbl, "");

    idle_pill = make_pill(idle_page, COL_DIM);
    idle_pill_lbl = lv_label_create(idle_pill);
    label_set(idle_pill_lbl, &lv_font_montserrat_16, COL_WHITE);
    lv_label_set_text(idle_pill_lbl, "NO LINK");
}

static void build_sessions_page(void) {
    sess_page = make_page(GAP_SM);

    lv_obj_t *title = lv_label_create(sess_page);
    label_set(title, &lv_font_montserrat_20, COL_DIM);
    lv_obj_set_style_margin_bottom(title, GAP_SM, 0);
    lv_label_set_text(title, "SESSIONS");

    for (int i = 0; i < MODEL_MAX_SESSIONS; i++) {
        lv_obj_t *row = lv_obj_create(sess_page);
        lv_obj_remove_style_all(row);
        lv_obj_set_size(row, SESS_ROW_W, SESS_ROW_H);
        lv_obj_set_style_radius(row, SESS_RADIUS, 0);
        lv_obj_set_style_bg_color(row, lv_color_hex(COL_BAR_TRACK), 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_hor(row, PILL_PAD_X, 0);
        lv_obj_set_style_pad_column(row, BAR_COL_GAP, 0);
        lv_obj_add_flag(row, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(row, on_row_click, LV_EVENT_CLICKED, (void *)(intptr_t)i);

        lv_obj_t *dot = lv_obj_create(row);
        lv_obj_remove_style_all(dot);
        lv_obj_set_size(dot, SESS_DOT, SESS_DOT);
        lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(dot, lv_color_hex(COL_LINKED), 0);
        lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);

        lv_obj_t *nm = lv_label_create(row);
        label_set(nm, &lv_font_montserrat_16, COL_WHITE);
        lv_label_set_long_mode(nm, LV_LABEL_LONG_DOT);
        lv_obj_set_width(nm, SESS_NAME_W);
        lv_label_set_text(nm, "");

        sess_row[i] = row;
        sess_dot[i] = dot;
        sess_name[i] = nm;
    }
}

static void build_notify_page(void) {
    notify_page = lv_obj_create(scr);
    lv_obj_remove_style_all(notify_page);
    lv_obj_set_size(notify_page, DISP_SIZE, DISP_SIZE);
    lv_obj_center(notify_page);
    lv_obj_set_style_bg_color(notify_page, lv_color_hex(COL_BG), 0);
    lv_obj_set_style_bg_opa(notify_page, LV_OPA_COVER, 0);
    lv_obj_remove_flag(notify_page, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(notify_page, LV_OBJ_FLAG_CLICKABLE);

    notify_ring = lv_arc_create(notify_page);
    lv_obj_set_size(notify_ring, RING_BOX, RING_BOX);
    lv_obj_center(notify_ring);
    lv_arc_set_bg_angles(notify_ring, 0, 360);
    lv_arc_set_angles(notify_ring, 0, 360);
    lv_obj_remove_flag(notify_ring, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(notify_ring, NOTIFY_RING_W, LV_PART_MAIN);
    lv_obj_set_style_arc_color(notify_ring, lv_color_hex(COL_RING_TRACK), LV_PART_MAIN);
    lv_obj_set_style_arc_width(notify_ring, NOTIFY_RING_W, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(notify_ring, lv_color_hex(COL_ATTENTION), LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(notify_ring, LV_OPA_TRANSP, LV_PART_KNOB);

    // centred text column
    lv_obj_t *col = lv_obj_create(notify_page);
    lv_obj_remove_style_all(col);
    lv_obj_remove_flag(col, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(col, NOTIFY_TEXT_W, DISP_SIZE);
    lv_obj_center(col);
    lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(col, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(col, GAP_MD, 0);

    notify_title = lv_label_create(col);
    label_set(notify_title, &lv_font_montserrat_28, COL_WHITE);
    lv_obj_set_width(notify_title, NOTIFY_TEXT_W);
    lv_obj_set_style_text_align(notify_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(notify_title, LV_LABEL_LONG_WRAP);
    lv_label_set_text(notify_title, "");

    notify_body = lv_label_create(col);
    label_set(notify_body, &lv_font_montserrat_20, COL_DIM);
    lv_obj_set_width(notify_body, NOTIFY_TEXT_W);
    lv_obj_set_style_text_align(notify_body, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(notify_body, LV_LABEL_LONG_WRAP);
    lv_label_set_text(notify_body, "");

    lv_obj_t *hint = lv_label_create(col);
    label_set(hint, &lv_font_montserrat_16, COL_DIM);
    lv_obj_set_style_margin_top(hint, GAP_LG, 0);
    lv_label_set_text(hint, "tap to dismiss");
}

// Shown while advertising in BLE pairing mode: the 6-digit code the host echoes.
static void build_pair_page(void) {
    pair_page = make_page(GAP_MD);

    lv_obj_t *title = lv_label_create(pair_page);
    label_set(title, &lv_font_montserrat_28, COL_WORKING);
    lv_label_set_text(title, "BLE PAIRING");

    pair_code_lbl = lv_label_create(pair_page);
    label_set(pair_code_lbl, &lv_font_montserrat_48, COL_WHITE);
    lv_obj_set_style_text_letter_space(pair_code_lbl, PAIR_CODE_TRACKING, 0);
    lv_label_set_text(pair_code_lbl, "------");

    lv_obj_t *hint = lv_label_create(pair_page);
    label_set(hint, &lv_font_montserrat_16, COL_DIM);
    lv_obj_set_style_margin_top(hint, GAP_MD, 0);
    lv_label_set_text(hint, "run  m5ct pair  on host");

    lv_obj_t *hint2 = lv_label_create(pair_page);
    label_set(hint2, &lv_font_montserrat_16, COL_DIM);
    lv_label_set_text(hint2, "long-press to cancel");
}

void ui_init(void) {
    scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(COL_BG), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(scr, LV_OBJ_FLAG_CLICKABLE);
    // SHORT_CLICKED (not CLICKED) so a long-press release doesn't also tap.
    lv_obj_add_event_cb(scr, on_scr_click, LV_EVENT_SHORT_CLICKED, NULL);
    lv_obj_add_event_cb(scr, on_scr_long_press, LV_EVENT_LONG_PRESSED, NULL);

    build_ring();
    build_live_page();
    build_idle_page();
    build_sessions_page();
    build_notify_page();
    build_pair_page();

    lv_timer_create(tick_cb, TICK_MS, NULL);
}

// ============================================================== screenshot ==
bool ui_capture_take(unsigned char **out, int *ow, int *oh) {
    if (esp_lv_adapter_lock(-1) != ESP_OK) return false;
    lv_draw_buf_t *snap = lv_snapshot_take(lv_screen_active(), LV_COLOR_FORMAT_RGB565);
    esp_lv_adapter_unlock();
    if (!snap) return false;

    int W = snap->header.w, H = snap->header.h;
    uint32_t stride = snap->header.stride;
    // sf=1 = full 466x466 (standalone dev-shot tool); raise to downsample if a
    // tighter transfer budget is ever needed.
    const int sf = 1;
    int w2 = W / sf, h2 = H / sf;
    unsigned char *dst = malloc((size_t)w2 * h2 * 2);
    bool ok = false;
    if (dst) {
        int di = 0;
        for (int y = 0; y < h2; y++) {
            const uint16_t *row =
                (const uint16_t *)((const uint8_t *)snap->data + (size_t)(y * sf) * stride);
            for (int x = 0; x < w2; x++) {
                uint16_t px = row[x * sf];
                dst[di++] = (unsigned char)(px >> 8);
                dst[di++] = (unsigned char)(px & 0xFF);
            }
        }
        *out = dst;
        *ow = w2;
        *oh = h2;
        ok = true;
    }
    lv_draw_buf_destroy(snap);
    return ok;
}

// ================================================================= refresh ==
static void set_bar(int i, bool present, int pct, const char *vtext) {
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    lv_obj_set_width(bar_fill[i], present ? (BAR_TRACK_W * pct) / 100 : 0);
    lv_obj_set_style_bg_color(bar_fill[i], lv_color_hex(usage_color(pct)), 0);
    lv_label_set_text(bar_val[i], vtext);
    lv_obj_set_style_text_color(bar_val[i], lv_color_hex(present ? COL_WHITE : COL_DIM), 0);
}

static void update_ring(activity_t a) {
    set_hidden(ring, false);
    lv_obj_set_style_arc_color(ring, lv_color_hex(activity_color(a)), LV_PART_INDICATOR);
    float wave = sinf(s_pulse) * 0.5f + 0.5f; // 0..1
    if (a == ACT_WORKING) {
        lv_arc_set_angles(ring, 0, RING_SEG_DEG); // a segment that sweeps the rim
        lv_arc_set_rotation(ring, s_spin);
        lv_obj_set_style_arc_opa(ring, LV_OPA_COVER, LV_PART_INDICATOR);
    } else {
        lv_arc_set_angles(ring, 0, 359); // full ring
        lv_arc_set_rotation(ring, 0);
        lv_opa_t opa = (a == ACT_ATTENTION) ? (lv_opa_t)(PULSE_RING_BASE + (int)(wave * PULSE_RING_SPAN))
                       : (a == ACT_AWAITING) ? CALM_RING_OPA
                                             : MIN_RING_OPA;
        lv_obj_set_style_arc_opa(ring, opa, LV_PART_INDICATOR);
    }
}

static void refresh_live(const model_t *m) {
    set_hidden(live_page, false);

    lv_label_set_text(model_lbl, m->model_short[0] ? m->model_short : "Claude");

    lv_obj_set_style_text_color(activity_lbl, lv_color_hex(activity_color(m->activity)), 0);
    lv_label_set_text(activity_lbl, activity_text(m->activity));
    update_ring(m->activity);

    char big[24];
    if (m->has_cost) snprintf(big, sizeof(big), "$%.2f", m->cost_session_usd);
    else if (m->has_ctx) snprintf(big, sizeof(big), "%d%%", m->ctx_used_pct);
    else big[0] = '\0';
    lv_label_set_text(metric_big, big);

    char sub[48];
    size_t off = 0;
    sub[0] = '\0';
    if (m->has_cost && m->cost_duration_min > 0) {
        if (m->cost_duration_min >= 60)
            off += snprintf(sub + off, sizeof(sub) - off, "%.1fh", m->cost_duration_min / 60.0f);
        else
            off += snprintf(sub + off, sizeof(sub) - off, "%dm", m->cost_duration_min);
    }
    if (m->has_cost && (m->lines_added || m->lines_removed)) {
        if (off) off += snprintf(sub + off, sizeof(sub) - off, "   ");
        off += snprintf(sub + off, sizeof(sub) - off, "+%d -%d", m->lines_added, m->lines_removed);
    }
    lv_label_set_text(metric_sub, sub);

    char v[8];
    if (m->has_ctx) {
        snprintf(v, sizeof(v), "%d%%", m->ctx_used_pct);
        set_bar(BAR_CTX, true, m->ctx_used_pct, v);
    } else set_bar(BAR_CTX, false, 0, "--");
    if (m->has_block) {
        snprintf(v, sizeof(v), "%d%%", m->block_used_pct);
        set_bar(BAR_BLOCK, true, m->block_used_pct, v);
    } else set_bar(BAR_BLOCK, false, 0, "--");
    if (m->has_weekly) {
        snprintf(v, sizeof(v), "%d%%", m->weekly_used_pct);
        set_bar(BAR_WEEK, true, m->weekly_used_pct, v);
    } else set_bar(BAR_WEEK, false, 0, "--");

    if (m->has_git && m->git_branch[0]) {
        int chg = m->git_staged + m->git_unstaged + m->git_untracked;
        char g[64];
        if (chg > 0) snprintf(g, sizeof(g), "%s  %d*", m->git_branch, chg);
        else snprintf(g, sizeof(g), "%s", m->git_branch);
        lv_label_set_text(git_lbl, g);
    } else {
        lv_label_set_text(git_lbl, "");
    }
}

static void refresh_idle(const model_t *m) {
    set_hidden(idle_page, false);

    time_t now = time(NULL);
    struct tm lt;
    localtime_r(&now, &lt);
    char hm[8];
    strftime(hm, sizeof(hm), "%H:%M", &lt);
    lv_label_set_text(clock_lbl, hm);
    char d[24];
    strftime(d, sizeof(d), "%a %d %b", &lt);
    for (char *c = d; *c; c++) *c = (char)toupper((unsigned char)*c);
    lv_label_set_text(date_lbl, d);

    if (m->link == LINK_LINKED) {
        lv_obj_set_style_bg_color(idle_pill, lv_color_hex(COL_LINKED), 0);
        char p[40];
        if (m->model_short[0]) snprintf(p, sizeof(p), "LINKED  %s", m->model_short);
        else snprintf(p, sizeof(p), "LINKED");
        lv_label_set_text(idle_pill_lbl, p);
    } else {
        lv_obj_set_style_bg_color(idle_pill, lv_color_hex(COL_DIM), 0);
        lv_label_set_text(idle_pill_lbl, "NO LINK");
    }
}

static void refresh_sessions(const model_t *m) {
    set_hidden(sess_page, false);
    for (int i = 0; i < MODEL_MAX_SESSIONS; i++) {
        if (i < m->session_count) {
            const session_t *s = &m->sessions[i];
            strncpy(s_row_id[i], s->id, sizeof(s_row_id[i]) - 1);
            s_row_id[i][sizeof(s_row_id[i]) - 1] = '\0';
            lv_obj_set_style_bg_color(sess_dot[i], lv_color_hex(activity_color(s->activity)), 0);
            lv_label_set_text(sess_name[i], s->name[0] ? s->name : s->id);
            lv_obj_set_style_bg_opa(sess_row[i], s->selected ? LV_OPA_40 : LV_OPA_TRANSP, 0);
            lv_obj_set_style_text_color(sess_name[i],
                                        lv_color_hex(s->selected ? COL_WHITE : COL_DIM), 0);
            set_hidden(sess_row[i], false);
        } else {
            s_row_id[i][0] = '\0';
            set_hidden(sess_row[i], true);
        }
    }
}

static void refresh_notify(const model_t *m) {
    set_hidden(notify_page, false);
    uint32_t uc = m->notify_urgency == URG_HIGH
                      ? COL_ATTENTION
                      : (m->notify_urgency == URG_LOW ? COL_DIM : COL_AWAITING);
    float wave = sinf(s_pulse) * 0.5f + 0.5f;
    lv_obj_set_style_arc_opa(notify_ring, (lv_opa_t)(PULSE_RING_BASE + (int)(wave * PULSE_RING_SPAN)),
                             LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(notify_ring, lv_color_hex(uc), LV_PART_INDICATOR);
    lv_label_set_text(notify_title, m->notify_title);
    lv_label_set_text(notify_body, m->notify_body);
}

static void refresh_pair(const model_t *m) {
    set_hidden(pair_page, false);
    lv_label_set_text(pair_code_lbl, m->pair_code[0] ? m->pair_code : "------");
}

static void hide_all_pages(void) {
    set_hidden(ring, true);
    set_hidden(live_page, true);
    set_hidden(idle_page, true);
    set_hidden(sess_page, true);
    set_hidden(notify_page, true);
    set_hidden(pair_page, true);
}

static void tick_cb(lv_timer_t *t) {
    (void)t;
    model_lock();
    model_t m = g_model;
    g_model.dirty = false;
    model_unlock();

    s_spin = (s_spin + RING_SPIN_STEP) % 360;
    s_pulse += (m.activity == ACT_ATTENTION) ? 0.45f : 0.22f;

    static int last_bright = -1;
    int want = (m.link == LINK_NOLINK) ? BRIGHT_IDLE : BRIGHT_ACTIVE;
    if (want != last_bright) {
        bsp_display_brightness_set(want);
        last_bright = want;
    }

    hide_all_pages();

    // Pairing takes over the screen while active (no host link yet anyway).
    if (m.ble_state == BLE_UI_PAIRING) {
        refresh_pair(&m);
        return;
    }

    if (m.notify_active) {
        if (m.notify_urgency != URG_HIGH &&
            (esp_timer_get_time() / 1000 - m.notify_shown_ms) > NOTIFY_AUTO_MS) {
            model_lock();
            g_model.notify_active = false;
            model_unlock();
        } else {
            refresh_notify(&m);
            return;
        }
    }

    if (m.link == LINK_LIVE && s_page == PAGE_SESSIONS && m.session_count > 0) {
        refresh_sessions(&m);
    } else if (m.link == LINK_LIVE) {
        if (s_page == PAGE_SESSIONS) s_page = PAGE_LIVE;
        refresh_live(&m);
    } else {
        refresh_idle(&m);
    }
}
