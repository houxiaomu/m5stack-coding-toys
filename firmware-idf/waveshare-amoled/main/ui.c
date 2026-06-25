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

// ---- palette (true black background; content glows) ----
#define COL_BG 0x000000
#define COL_WHITE 0xF1F5F9
#define COL_DIM 0x64748B
#define COL_TRACK 0x1E293B
#define COL_WORKING 0x22D3EE   // cyan
#define COL_AWAITING 0xF59E0B  // amber
#define COL_ATTENTION 0xEF4444 // red
#define COL_LINKED 0x22C55E    // green
#define COL_CTX_OK 0x38BDF8    // sky
#define COL_CTX_WARN 0xF59E0B
#define COL_CTX_HOT 0xEF4444
#define COL_ADDED 0x22C55E
#define COL_REMOVED 0xF87171

typedef enum { PAGE_LIVE = 0, PAGE_SESSIONS } page_t;

// ---- widgets ----
static lv_obj_t *scr;
static lv_obj_t *ctx_arc, *block_arc;
static lv_obj_t *model_pill, *model_lbl;
static lv_obj_t *orb;
static lv_obj_t *activity_lbl;
static lv_obj_t *metric_big, *metric_sub, *git_lbl;
static lv_obj_t *clock_lbl, *date_lbl, *idle_pill, *idle_pill_lbl;
static lv_obj_t *sess_cont, *sess_title;
static lv_obj_t *sess_row[MODEL_MAX_SESSIONS], *sess_dot[MODEL_MAX_SESSIONS],
    *sess_name[MODEL_MAX_SESSIONS];
static lv_obj_t *notify_cont, *notify_ring, *notify_title, *notify_body, *notify_hint;

static page_t s_page = PAGE_LIVE;
static float s_phase = 0.0f;
static char s_row_id[MODEL_MAX_SESSIONS][24];

static void tick_cb(lv_timer_t *t);

// ------------------------------------------------------------- helpers ----

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

// ------------------------------------------------------------- events ----

static void on_scr_click(lv_event_t *e) {
    (void)e;
    model_lock();
    bool notif = g_model.notify_active;
    bool multi = (g_model.link == LINK_LIVE && g_model.session_count > 1);
    if (notif) {
        g_model.notify_active = false;
        g_model.dirty = true;
    }
    model_unlock();
    if (notif) return; // first tap just clears the alert
    if (multi) s_page = (s_page == PAGE_LIVE) ? PAGE_SESSIONS : PAGE_LIVE;
}

static void on_row_click(lv_event_t *e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    if (idx >= 0 && idx < MODEL_MAX_SESSIONS && s_row_id[idx][0]) {
        proto_send_focus(s_row_id[idx]);
    }
}

// ------------------------------------------------------------- build ----

static lv_obj_t *make_pill(lv_obj_t *parent, uint32_t bg) {
    lv_obj_t *p = lv_obj_create(parent);
    lv_obj_remove_style_all(p);
    lv_obj_set_style_radius(p, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(p, lv_color_hex(bg), 0);
    lv_obj_set_style_bg_opa(p, LV_OPA_30, 0);
    lv_obj_set_style_pad_hor(p, 14, 0);
    lv_obj_set_style_pad_ver(p, 5, 0);
    lv_obj_set_height(p, LV_SIZE_CONTENT);
    lv_obj_set_width(p, LV_SIZE_CONTENT);
    return p;
}

static void setup_ring(lv_obj_t *a, int size, int width, uint32_t track) {
    lv_obj_set_size(a, size, size);
    lv_obj_center(a);
    lv_arc_set_rotation(a, 270);
    lv_arc_set_bg_angles(a, 0, 360);
    lv_arc_set_range(a, 0, 100);
    lv_arc_set_value(a, 0);
    lv_obj_remove_flag(a, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(a, width, LV_PART_MAIN);
    lv_obj_set_style_arc_width(a, width, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(a, lv_color_hex(track), LV_PART_MAIN);
    lv_obj_set_style_arc_rounded(a, true, LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(a, false, LV_PART_MAIN);
    // hide the draggable knob
    lv_obj_set_style_bg_opa(a, LV_OPA_TRANSP, LV_PART_KNOB);
    lv_obj_set_style_pad_all(a, 0, LV_PART_KNOB);
}

void ui_init(void) {
    scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(COL_BG), 0);
    lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(scr, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(scr, on_scr_click, LV_EVENT_CLICKED, NULL);

    // --- rings ---
    ctx_arc = lv_arc_create(scr);
    setup_ring(ctx_arc, 452, 12, COL_TRACK);
    lv_obj_set_style_arc_color(ctx_arc, lv_color_hex(COL_CTX_OK), LV_PART_INDICATOR);

    block_arc = lv_arc_create(scr);
    setup_ring(block_arc, 420, 5, COL_TRACK);
    lv_obj_set_style_arc_color(block_arc, lv_color_hex(COL_AWAITING), LV_PART_INDICATOR);

    // --- live: model pill (top) ---
    model_pill = make_pill(scr, COL_DIM);
    lv_obj_align(model_pill, LV_ALIGN_CENTER, 0, -150);
    model_lbl = lv_label_create(model_pill);
    lv_obj_set_style_text_font(model_lbl, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(model_lbl, lv_color_hex(COL_WHITE), 0);
    lv_label_set_text(model_lbl, "Claude");

    // --- live: activity orb ---
    orb = lv_obj_create(scr);
    lv_obj_remove_style_all(orb);
    lv_obj_set_size(orb, 96, 96);
    lv_obj_align(orb, LV_ALIGN_CENTER, 0, -68);
    lv_obj_set_style_radius(orb, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(orb, lv_color_hex(COL_WORKING), 0);
    lv_obj_set_style_bg_opa(orb, LV_OPA_COVER, 0);
    lv_obj_set_style_shadow_color(orb, lv_color_hex(COL_WORKING), 0);
    lv_obj_set_style_shadow_width(orb, 30, 0);
    lv_obj_set_style_shadow_spread(orb, 2, 0);
    lv_obj_remove_flag(orb, LV_OBJ_FLAG_CLICKABLE);

    activity_lbl = lv_label_create(scr);
    lv_obj_set_style_text_font(activity_lbl, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(activity_lbl, lv_color_hex(COL_WHITE), 0);
    lv_obj_align(activity_lbl, LV_ALIGN_CENTER, 0, 8);
    lv_label_set_text(activity_lbl, "ACTIVE");

    metric_big = lv_label_create(scr);
    lv_obj_set_style_text_font(metric_big, &lv_font_montserrat_36, 0);
    lv_obj_set_style_text_color(metric_big, lv_color_hex(COL_WHITE), 0);
    lv_obj_align(metric_big, LV_ALIGN_CENTER, 0, 48);
    lv_label_set_text(metric_big, "");

    metric_sub = lv_label_create(scr);
    lv_obj_set_style_text_font(metric_sub, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(metric_sub, lv_color_hex(COL_DIM), 0);
    lv_obj_align(metric_sub, LV_ALIGN_CENTER, 0, 88);
    lv_label_set_text(metric_sub, "");

    git_lbl = lv_label_create(scr);
    lv_obj_set_style_text_font(git_lbl, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(git_lbl, lv_color_hex(COL_DIM), 0);
    lv_obj_align(git_lbl, LV_ALIGN_CENTER, 0, 150);
    lv_label_set_text(git_lbl, "");

    // --- idle face ---
    clock_lbl = lv_label_create(scr);
    lv_obj_set_style_text_font(clock_lbl, &lv_font_montserrat_48, 0);
    lv_obj_set_style_text_color(clock_lbl, lv_color_hex(COL_WHITE), 0);
    lv_obj_align(clock_lbl, LV_ALIGN_CENTER, 0, -28);
    lv_label_set_text(clock_lbl, "--:--");

    date_lbl = lv_label_create(scr);
    lv_obj_set_style_text_font(date_lbl, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(date_lbl, lv_color_hex(COL_DIM), 0);
    lv_obj_align(date_lbl, LV_ALIGN_CENTER, 0, 24);
    lv_label_set_text(date_lbl, "");

    idle_pill = make_pill(scr, COL_DIM);
    lv_obj_align(idle_pill, LV_ALIGN_CENTER, 0, 78);
    idle_pill_lbl = lv_label_create(idle_pill);
    lv_obj_set_style_text_font(idle_pill_lbl, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(idle_pill_lbl, lv_color_hex(COL_WHITE), 0);
    lv_label_set_text(idle_pill_lbl, "NO LINK");

    // --- sessions page ---
    sess_title = lv_label_create(scr);
    lv_obj_set_style_text_font(sess_title, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(sess_title, lv_color_hex(COL_DIM), 0);
    lv_obj_align(sess_title, LV_ALIGN_CENTER, 0, -150);
    lv_label_set_text(sess_title, "SESSIONS");

    sess_cont = lv_obj_create(scr);
    lv_obj_remove_style_all(sess_cont);
    lv_obj_set_size(sess_cont, 300, 280);
    lv_obj_align(sess_cont, LV_ALIGN_CENTER, 0, 10);
    lv_obj_set_flex_flow(sess_cont, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(sess_cont, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER,
                          LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(sess_cont, 6, 0);
    lv_obj_remove_flag(sess_cont, LV_OBJ_FLAG_SCROLLABLE);

    for (int i = 0; i < MODEL_MAX_SESSIONS; i++) {
        lv_obj_t *row = lv_obj_create(sess_cont);
        lv_obj_remove_style_all(row);
        lv_obj_set_size(row, 280, 34);
        lv_obj_set_style_radius(row, 17, 0);
        lv_obj_set_style_bg_color(row, lv_color_hex(COL_TRACK), 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_TRANSP, 0);
        lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_hor(row, 14, 0);
        lv_obj_set_style_pad_column(row, 10, 0);
        lv_obj_add_flag(row, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(row, on_row_click, LV_EVENT_CLICKED, (void *)(intptr_t)i);

        lv_obj_t *dot = lv_obj_create(row);
        lv_obj_remove_style_all(dot);
        lv_obj_set_size(dot, 12, 12);
        lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(dot, lv_color_hex(COL_LINKED), 0);
        lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);

        lv_obj_t *nm = lv_label_create(row);
        lv_obj_set_style_text_font(nm, &lv_font_montserrat_16, 0);
        lv_obj_set_style_text_color(nm, lv_color_hex(COL_WHITE), 0);
        lv_label_set_long_mode(nm, LV_LABEL_LONG_DOT);
        lv_obj_set_width(nm, 230);
        lv_label_set_text(nm, "");

        sess_row[i] = row;
        sess_dot[i] = dot;
        sess_name[i] = nm;
    }

    // --- notify overlay ---
    notify_cont = lv_obj_create(scr);
    lv_obj_remove_style_all(notify_cont);
    lv_obj_set_size(notify_cont, 466, 466);
    lv_obj_center(notify_cont);
    lv_obj_set_style_bg_color(notify_cont, lv_color_hex(COL_BG), 0);
    lv_obj_set_style_bg_opa(notify_cont, LV_OPA_COVER, 0);
    lv_obj_remove_flag(notify_cont, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(notify_cont, LV_OBJ_FLAG_CLICKABLE); // let taps fall to scr

    notify_ring = lv_arc_create(notify_cont);
    setup_ring(notify_ring, 452, 12, COL_TRACK);
    lv_arc_set_value(notify_ring, 100);
    lv_obj_set_style_arc_color(notify_ring, lv_color_hex(COL_ATTENTION), LV_PART_INDICATOR);

    notify_title = lv_label_create(notify_cont);
    lv_obj_set_style_text_font(notify_title, &lv_font_montserrat_28, 0);
    lv_obj_set_style_text_color(notify_title, lv_color_hex(COL_WHITE), 0);
    lv_obj_set_width(notify_title, 320);
    lv_obj_set_style_text_align(notify_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(notify_title, LV_LABEL_LONG_WRAP);
    lv_obj_align(notify_title, LV_ALIGN_CENTER, 0, -40);
    lv_label_set_text(notify_title, "");

    notify_body = lv_label_create(notify_cont);
    lv_obj_set_style_text_font(notify_body, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(notify_body, lv_color_hex(COL_DIM), 0);
    lv_obj_set_width(notify_body, 320);
    lv_obj_set_style_text_align(notify_body, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(notify_body, LV_LABEL_LONG_WRAP);
    lv_obj_align(notify_body, LV_ALIGN_CENTER, 0, 30);
    lv_label_set_text(notify_body, "");

    notify_hint = lv_label_create(notify_cont);
    lv_obj_set_style_text_font(notify_hint, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(notify_hint, lv_color_hex(COL_DIM), 0);
    lv_obj_align(notify_hint, LV_ALIGN_CENTER, 0, 150);
    lv_label_set_text(notify_hint, "tap to dismiss");

    // repaint at 10 Hz (also drives the orb / notify breathing animation)
    lv_timer_create(tick_cb, 100, NULL);
}

// ------------------------------------------------------------- refresh ----

static void show_group(bool arcs, bool live, bool idle, bool sess, bool notify) {
    set_hidden(ctx_arc, !arcs);
    set_hidden(block_arc, !arcs);
    set_hidden(model_pill, !live);
    set_hidden(orb, !live);
    set_hidden(activity_lbl, !live);
    set_hidden(metric_big, !live);
    set_hidden(metric_sub, !live);
    set_hidden(git_lbl, !live);
    set_hidden(clock_lbl, !idle);
    set_hidden(date_lbl, !idle);
    set_hidden(idle_pill, !idle);
    set_hidden(sess_title, !sess);
    set_hidden(sess_cont, !sess);
    set_hidden(notify_cont, !notify);
}

static void refresh_live(const model_t *m) {
    // model pill
    lv_label_set_text(model_lbl, m->model_short[0] ? m->model_short : "Claude");

    // orb color + breathing
    uint32_t ac = activity_color(m->activity);
    lv_obj_set_style_bg_color(orb, lv_color_hex(ac), 0);
    lv_obj_set_style_shadow_color(orb, lv_color_hex(ac), 0);
    float speed = 0.10f;
    if (m->activity == ACT_WORKING) speed = 0.20f;
    else if (m->activity == ACT_ATTENTION) speed = 0.32f;
    s_phase += speed;
    float s = sinf(s_phase) * 0.5f + 0.5f; // 0..1
    lv_obj_set_style_bg_opa(orb, (lv_opa_t)(90 + (int)(s * 165)), 0);
    lv_obj_set_style_shadow_width(orb, 14 + (int)(s * 36), 0);

    lv_obj_set_style_text_color(activity_lbl, lv_color_hex(ac), 0);
    lv_label_set_text(activity_lbl, activity_text(m->activity));

    // context ring
    if (m->has_ctx) {
        int pct = m->ctx_used_pct;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        lv_arc_set_value(ctx_arc, pct);
        uint32_t cc = pct < 60 ? COL_CTX_OK : (pct < 85 ? COL_CTX_WARN : COL_CTX_HOT);
        if (m->ctx_exceeds_200k) cc = COL_CTX_HOT;
        lv_obj_set_style_arc_color(ctx_arc, lv_color_hex(cc), LV_PART_INDICATOR);
    } else {
        lv_arc_set_value(ctx_arc, 0);
    }

    // 5h block ring
    if (m->has_block) {
        int bp = m->block_used_pct;
        if (bp < 0) bp = 0;
        if (bp > 100) bp = 100;
        lv_arc_set_value(block_arc, bp);
        set_hidden(block_arc, false);
    } else {
        set_hidden(block_arc, true);
    }

    // primary metric: cost if known, else context %
    char big[24];
    if (m->has_cost) {
        snprintf(big, sizeof(big), "$%.2f", m->cost_session_usd);
    } else if (m->has_ctx) {
        snprintf(big, sizeof(big), "%d%%", m->ctx_used_pct);
    } else {
        big[0] = '\0';
    }
    lv_label_set_text(metric_big, big);

    // secondary line: ctx · duration · lines
    char sub[64];
    sub[0] = '\0';
    size_t off = 0;
    if (m->has_ctx)
        off += snprintf(sub + off, sizeof(sub) - off, "ctx %d%%", m->ctx_used_pct);
    if (m->has_cost && m->cost_duration_min > 0) {
        if (off) off += snprintf(sub + off, sizeof(sub) - off, "  ");
        if (m->cost_duration_min >= 60)
            off += snprintf(sub + off, sizeof(sub) - off, "%.1fh",
                            m->cost_duration_min / 60.0f);
        else
            off += snprintf(sub + off, sizeof(sub) - off, "%dm", m->cost_duration_min);
    }
    if (m->has_cost && (m->lines_added || m->lines_removed)) {
        if (off) off += snprintf(sub + off, sizeof(sub) - off, "  ");
        off += snprintf(sub + off, sizeof(sub) - off, "+%d -%d", m->lines_added,
                        m->lines_removed);
    }
    lv_label_set_text(metric_sub, sub);

    // git footer
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
    uint32_t uc = m->notify_urgency == URG_HIGH
                      ? COL_ATTENTION
                      : (m->notify_urgency == URG_LOW ? COL_DIM : COL_AWAITING);
    // pulsing ring opacity
    s_phase += (m->notify_urgency == URG_HIGH) ? 0.35f : 0.18f;
    float s = sinf(s_phase) * 0.5f + 0.5f;
    lv_obj_set_style_arc_opa(notify_ring, (lv_opa_t)(120 + (int)(s * 135)), LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(notify_ring, lv_color_hex(uc), LV_PART_INDICATOR);
    lv_label_set_text(notify_title, m->notify_title);
    lv_label_set_text(notify_body, m->notify_body);
}

#ifdef SHOT_DIAG
// Diagnostic: synthesize a frame WITHOUT lv_snapshot to isolate whether the
// slow path is the snapshot render or the protocol/TX. Colored quadrants so the
// PNG also confirms RGB565 byte order (TL red, TR green, BL blue, BR white).
bool ui_capture_take(unsigned char **out, int *ow, int *oh) {
    const int w = 116, h = 116;
    unsigned char *dst = heap_caps_malloc((size_t)w * h * 2, MALLOC_CAP_SPIRAM);
    if (!dst) return false;
    int di = 0;
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            uint16_t px;
            if (y < h / 2 && x < w / 2) px = 0xF800;      // red
            else if (y < h / 2) px = 0x07E0;              // green
            else if (x < w / 2) px = 0x001F;              // blue
            else px = 0xFFFF;                             // white
            dst[di++] = (unsigned char)(px >> 8);
            dst[di++] = (unsigned char)(px & 0xFF);
        }
    }
    *out = dst;
    *ow = w;
    *oh = h;
    return true;
}
#else
bool ui_capture_take(unsigned char **out, int *ow, int *oh) {
    if (esp_lv_adapter_lock(-1) != ESP_OK) return false;
    lv_draw_buf_t *snap = lv_snapshot_take(lv_screen_active(), LV_COLOR_FORMAT_RGB565);
    esp_lv_adapter_unlock();
    if (!snap) return false;

    int W = snap->header.w, H = snap->header.h;
    uint32_t stride = snap->header.stride; // bytes per row
    // 4x downsample (466->116) keeps the base64 frame ~36KB so the whole ack
    // streams over the native USB-Serial/JTAG port well within the host's 5s
    // request timeout. Plenty of detail to verify the layout.
    const int sf = 4;
    int w2 = W / sf, h2 = H / sf;
    unsigned char *dst = malloc((size_t)w2 * h2 * 2);
    bool ok = false;
    if (dst) {
        int di = 0;
        for (int y = 0; y < h2; y++) {
            const uint16_t *row =
                (const uint16_t *)((const uint8_t *)snap->data + (size_t)(y * sf) * stride);
            for (int x = 0; x < w2; x++) {
                uint16_t px = row[x * sf]; // native little-endian RGB565
                dst[di++] = (unsigned char)(px >> 8); // big-endian for the host decoder
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
#endif

static void tick_cb(lv_timer_t *t) {
    (void)t;
    model_lock();
    model_t m = g_model; // snapshot
    g_model.dirty = false;
    model_unlock();

    // brightness: dim while there's no link, bright otherwise
    static int last_bright = -1;
    int want = (m.link == LINK_NOLINK) ? 35 : 100;
    if (want != last_bright) {
        bsp_display_brightness_set(want);
        last_bright = want;
    }

    // notify overlay wins; auto-dismiss low/normal after 8s
    if (m.notify_active) {
        if (m.notify_urgency != URG_HIGH &&
            (esp_timer_get_time() / 1000 - m.notify_shown_ms) > 8000) {
            model_lock();
            g_model.notify_active = false;
            model_unlock();
        } else {
            show_group(false, false, false, false, true);
            refresh_notify(&m);
            return;
        }
    }

    if (m.link == LINK_LIVE && s_page == PAGE_SESSIONS && m.session_count > 0) {
        show_group(false, false, false, true, false);
        refresh_sessions(&m);
    } else if (m.link == LINK_LIVE) {
        if (s_page == PAGE_SESSIONS) s_page = PAGE_LIVE; // sessions vanished
        show_group(true, true, false, false, false);
        refresh_live(&m);
    } else {
        show_group(false, false, true, false, false);
        refresh_idle(&m);
    }
}
