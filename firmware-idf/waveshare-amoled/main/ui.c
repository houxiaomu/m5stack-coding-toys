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
#define COL_WORKING 0x4ADE80   // green
#define COL_AWAITING 0xF59E0B  // amber
#define COL_ATTENTION 0xEF4444 // red
#define COL_LINKED 0x22C55E    // green
#define COL_USAGE_LOW 0x38BDF8  // sky
#define COL_USAGE_MID 0xF59E0B  // amber
#define COL_USAGE_HIGH 0xEF4444 // red
// Selection accent for the session picker. Sky (not green/amber/red — those are
// reserved for activity state, incl. the per-session dots, so reusing one would
// clash with a WORKING/AWAITING/ATTENTION dot). Sky reads as a neutral UI accent.
#define COL_SELECT 0x38BDF8

// Display geometry (466x466 round panel).
#define DISP_SIZE 466
#define RING_BOX 458       // arc bounding box, just inside the bezel
#define RING_TRACK_W 3
#define RING_SEG_W 7

// Working spinner = a small dot orbiting the rim, driven by lv_anim (smooth
// interpolation at the display refresh rate).
//
// Cost note: the panel renders in 50px partial-buffer chunks on a software
// (no-GPU) rasterizer, so per-frame cost scales with the *invalidated area*. An
// arc on this big rim has a huge bounding box → ~10fps. Moving a small dot only
// invalidates its old+new rects (~SPINNER_D²×2 px), a tiny constant area, so it
// renders far faster and keeps a high, steady FPS.
#define SPINNER_D 16       // dot diameter (px)
#define SPINNER_MARGIN 4   // gap from the bezel/track to the dot centre
#define SPINNER_REV_MS 2200 // time for one full revolution

// Spacing scale (used for flex gaps & margins — relative, not absolute coords).
#define GAP_TIGHT 2
#define GAP_SM 8
#define GAP_MD 16
#define GAP_LG 24

// Pill padding.
#define PILL_PAD_X 14
#define PILL_PAD_Y 5

// Fixed width for the live page's value labels (cost/activity/sub/git) so their
// text can change without re-flowing the page. Inside the round content area.
#define LIVE_LBL_W 380

// Usage bar row: [name][track][value].
#define BAR_TRACK_W 120
#define BAR_H 8
#define BAR_NAME_W 76
#define BAR_VALUE_W 48
#define BAR_COL_GAP 10
#define USAGE_WARN_PCT 60 // < warn → low colour
#define USAGE_HOT_PCT 85  // ≥ hot → high colour

// Banner = a fixed-size info area between the activity label and the usage bars
// that auto-rotates through a few info "cards". CRITICAL: it has a FIXED size, so
// its content/transition only invalidates its own rect — it never triggers a
// live_page flex relayout (which would full-screen repaint and starve the working
// spinner's FPS). Two cards ping-pong; the off-screen one rolls in from below.
#define BANNER_W 380
#define BANNER_H 110
#define BANNER_DWELL_MS 3500 // time each card is shown before rolling to the next
#define BANNER_ANIM_MS 350   // odometer roll duration
#define BANNER_TICK_MS 200   // banner's own driver period (decoupled from the live tick)

// Rotating card identities (also the rotation order).
enum {
    BANNER_GIT = 0,
    BANNER_DIFF,
    BANNER_MODEL,
    BANNER_COST,
    BANNER_QUOTA,
    N_BANNER,
};

// Sessions page — phone-style scrollable card list (round-safe centred geometry).
#define SESS_TITLE_TOP 44    // title y from top (clears the round crown)
#define SESS_LIST_W 380      // scroll container width (transparent → its corners
                             // may sit outside the circle; only card bgs show)
#define SESS_LIST_H 300      // scroll container height
#define SESS_LIST_TOP 84     // list y from top (below the fixed title)
#define SESS_CARD_W 360      // card width. The selected (highlighted) card is
                             // snap-centred where the circle is widest, so a
                             // wider card stays well inside the round bezel.
#define SESS_CARD_H 88       // card height — large finger tap target
#define SESS_CARD_RADIUS 20
#define SESS_LIST_PAD_V 8    // list top/bottom breathing room. Cards sit FLUSH
                             // (no inter-card gap) so the tap zones are continuous.
#define SESS_CARD_PAD_X 18
#define SESS_CARD_COL_GAP 14
#define SESS_DOT_D 24        // activity dot diameter

// Notify overlay.
#define NOTIFY_RING_W 8
#define NOTIFY_TEXT_W 320

// Pairing screen.
#define PAIR_CODE_TRACKING 6    // letter spacing for the 6-digit code

// Behaviour.
#define TICK_MS 80              // UI repaint / animation tick
#define LONG_PRESS_MS 3000      // hold-to-pair threshold (deliberate; avoids mis-touch)
#define SHOW_FPS 1              // diagnostic FPS readout under the usage bars (set 0 to strip)
#define NOTIFY_AUTO_MS 8000     // low/normal notify auto-dismiss
#define BRIGHT_IDLE 35
#define BRIGHT_ACTIVE 100
#define MIN_RING_OPA 70
#define CALM_RING_OPA 150
#define PULSE_RING_BASE 120
#define PULSE_RING_SPAN 135

#define N_BARS 3
enum { BAR_CTX = 0, BAR_BLOCK, BAR_WEEK };
static const char *BAR_LABELS[N_BARS] = {"Context", "5 Hour", "Week"};

typedef enum { PAGE_LIVE = 0, PAGE_SESSIONS } page_t;

// Which full-screen view is currently shown. Tracked so the tick only toggles
// page visibility on a real transition (not every tick).
typedef enum {
    VIEW_NONE = 0,
    VIEW_PAIR,
    VIEW_NOTIFY,
    VIEW_SESSIONS,
    VIEW_LIVE,
    VIEW_IDLE,
} view_t;

// ============================================================ widget handles ==
static lv_obj_t *scr;
static lv_obj_t *ring;
static lv_obj_t *spinner; // working spinner: a dot orbiting the rim
// live page
static lv_obj_t *live_page, *activity_lbl;
static lv_obj_t *bar_fill[N_BARS], *bar_val[N_BARS];
#if SHOW_FPS
static lv_obj_t *fps_lbl;
#endif
// banner (rotating info area): two ping-pong cards, each a label/hero/sub column
static lv_obj_t *banner, *bcard[2], *blabel[2], *bhero[2], *bsub[2];
// idle page
static lv_obj_t *idle_page, *clock_lbl, *date_lbl, *idle_pill, *idle_pill_lbl;
// sessions page
static lv_obj_t *sess_page, *sess_title, *sess_row[MODEL_MAX_SESSIONS],
    *sess_dot[MODEL_MAX_SESSIONS], *sess_name[MODEL_MAX_SESSIONS];
// notify page
static lv_obj_t *notify_page, *notify_ring, *notify_title, *notify_body;
// pairing page
static lv_obj_t *pair_page, *pair_code_lbl;

static page_t s_page = PAGE_LIVE;
static view_t s_view = VIEW_NONE; // currently shown view (transition tracking)
static int s_spin = 0;       // current spinner orbit angle (driven by lv_anim)
static int s_anim_var = 0;   // dummy var to anchor the rotation animation
static bool s_working = false; // spinner is the active indicator this frame
static float s_pulse = 0;
#if SHOW_FPS
static volatile uint32_t s_fps_frames = 0; // rendered frames since last sample
static int s_fps = 0;                      // last measured frames/sec
#endif
static char s_row_id[MODEL_MAX_SESSIONS][24];

// Banner rotation state (driven by its own lv_timer, independent of the live tick
// so it keeps rotating even when steady-WORKING skips the full live refresh).
static int s_banner_cur = BANNER_GIT;   // card id currently shown in the front slot
static int s_banner_front = 0;          // which bcard[] slot is the front (visible) card
static int64_t s_banner_last_ms = 0;    // last advance time (esp_timer ms)
static bool s_banner_anim = false;      // an odometer roll is in flight
static int s_banner_anim_var = 0;       // anchors the roll animation

static void tick_cb(lv_timer_t *t);

// ================================================================== helpers ==
static void set_hidden(lv_obj_t *o, bool hide) {
    if (!o) return;
    // Idempotent: if already in the requested state, do nothing. Toggling the
    // HIDDEN flag invalidates the object's whole area, so a redundant
    // show-when-already-shown every tick would force a full page repaint.
    if (lv_obj_has_flag(o, LV_OBJ_FLAG_HIDDEN) == hide) return;
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

// Pin a flex-child label to a fixed width, centered, single-line (clipped). Its
// text can then change without resizing the label — so updates repaint only the
// label's own area instead of re-flowing the whole page (a full-page flex
// relayout invalidates, and re-transmits, the entire screen ≈ 90ms here).
static void label_fixed(lv_obj_t *l, int w) {
    lv_obj_set_width(l, w);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(l, LV_LABEL_LONG_CLIP);
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
    if (idx < 0 || idx >= MODEL_MAX_SESSIONS || !s_row_id[idx][0]) return;
    // Two-stage tap: first tap focuses the session (host marks it selected); a
    // second tap on the already-selected session opens its Live page.
    model_lock();
    bool already = (idx < g_model.session_count && g_model.sessions[idx].selected);
    model_unlock();
    if (already) s_page = PAGE_LIVE;
    else proto_send_focus(s_row_id[idx]);
}

// =================================================================== build ==
static void build_ring(void) {
    ring = lv_arc_create(scr);
    lv_obj_set_size(ring, RING_BOX, RING_BOX);
    lv_obj_center(ring);
    lv_arc_set_bg_angles(ring, 0, 360);
    lv_arc_set_angles(ring, 0, 359);
    lv_obj_remove_flag(ring, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(ring, RING_TRACK_W, LV_PART_MAIN);
    lv_obj_set_style_arc_color(ring, lv_color_hex(COL_RING_TRACK), LV_PART_MAIN);
    lv_obj_set_style_arc_width(ring, RING_SEG_W, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(ring, lv_color_hex(COL_WORKING), LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(ring, true, LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(ring, LV_OPA_TRANSP, LV_PART_KNOB);
    lv_obj_set_style_pad_all(ring, 0, LV_PART_KNOB);
}

// Build the working spinner: a small green dot that orbits the rim. A moving
// dot invalidates only its old+new rects, so it's cheap to render (unlike an
// arc, whose rim-spanning bounding box is huge for the software rasterizer).
static void build_spinner(void) {
    // A plain child of the screen: moving it invalidates (and so redraws/erases)
    // its old + new rects. It must NOT live on lv_layer_top() — there, partial
    // refresh fails to erase the old position and the dot smears a trail.
    spinner = lv_obj_create(scr);
    lv_obj_remove_style_all(spinner);
    lv_obj_remove_flag(spinner, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(spinner, SPINNER_D, SPINNER_D);
    lv_obj_set_style_radius(spinner, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(spinner, lv_color_hex(COL_WORKING), 0);
    lv_obj_set_style_bg_opa(spinner, LV_OPA_COVER, 0);
    lv_obj_add_flag(spinner, LV_OBJ_FLAG_HIDDEN);
}

// Position the dot at `deg` around the rim (0° = 3 o'clock, clockwise).
static void update_spinner(int deg) {
    float rad = (float)deg * 3.14159265f / 180.0f;
    int c = DISP_SIZE / 2;                          // screen centre
    int r = RING_BOX / 2 - RING_SEG_W / 2 - SPINNER_MARGIN; // orbit radius
    int x = c + (int)(r * cosf(rad)) - SPINNER_D / 2;
    int y = c + (int)(r * sinf(rad)) - SPINNER_D / 2;
    lv_obj_set_pos(spinner, x, y);
}

// lv_anim exec callback: advances the orbit angle at the display refresh rate
// for a smooth sweep. Skips work unless the spinner is the active indicator.
static void spinner_anim_cb(void *var, int32_t v) {
    (void)var;
    s_spin = (int)v;
    if (s_working) update_spinner(s_spin);
}

// The CO5300 only accepts partial writes on even pixel boundaries. LVGL's
// invalidation rects (e.g. the spinner dot at cos/sin-derived odd coords) are
// otherwise sent unaligned, so the controller mis-places the partial write and
// the vacated pixels are never overwritten — leaving a trail of stale dots.
// Round every invalidated area out to an even origin and even width/height.
static void area_rounder_cb(lv_event_t *e) {
    lv_area_t *a = (lv_area_t *)lv_event_get_param(e);
    if (!a) return;
    a->x1 &= ~1;
    a->y1 &= ~1;
    a->x2 |= 1;
    a->y2 |= 1;
}

#if SHOW_FPS
// Fires once per actually-rendered frame; tick_cb samples the count each second.
static void fps_render_ready_cb(lv_event_t *e) {
    (void)e;
    s_fps_frames++;
}
#endif

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

// =================================================================== banner ==
// git status counts are per-file, so their sum is the changed-file count.
static int git_file_count(const model_t *m) {
    return m->git_staged + m->git_unstaged + m->git_untracked;
}

// "38.2k" for >=1000, plain int otherwise.
static void fmt_k(char *out, size_t n, int v) {
    if (v < 1000) snprintf(out, n, "%d", v);
    else snprintf(out, n, "%.1fk", v / 1000.0f);
}

// Write a card id's label/hero/sub text+colour into bcard[slot]. All formatting
// for the rotating cards lives here. Uses only existing model_t fields.
static void fill_banner_card(int slot, int id, const model_t *m) {
    char h[40], s[56];
    uint32_t hero_col = COL_WHITE, sub_col = COL_DIM;
    h[0] = '\0';
    s[0] = '\0';
    switch (id) {
        case BANNER_GIT: {
            // Project identity: repo-root name (hero) + branch (sub) — answers
            // "which project, which line of work" at a glance across parallel
            // sessions. Falls back to the old branch+dirty layout if the daemon
            // doesn't send a repo name yet.
            lv_label_set_text(blabel[slot], "REPO");
            // Project name: git.repo (robust repo-root, new daemon) → workspace
            // dir basename (works with the current daemon) → branch as last resort.
            const char *proj = m->git_repo[0] ? m->git_repo : (m->ws_name[0] ? m->ws_name : NULL);
            if (proj) {
                snprintf(h, sizeof(h), "%s", proj);
                snprintf(s, sizeof(s), "%s", m->git_branch);
            } else {
                snprintf(h, sizeof(h), "%s", m->git_branch[0] ? m->git_branch : "--");
                int n = git_file_count(m);
                if (n <= 0) snprintf(s, sizeof(s), "working tree clean");
                else snprintf(s, sizeof(s), "%d file%s changed", n, n == 1 ? "" : "s");
            }
            break;
        }
        case BANNER_DIFF: {
            // Working-tree diff: files and lines from one source (git.diff) so
            // they always agree (unlike pairing session-cumulative lines with the
            // current dirty-file count, which diverge after a commit).
            lv_label_set_text(blabel[slot], "DIFF");
            snprintf(h, sizeof(h), "+%d  -%d", m->git_diff_added, m->git_diff_removed);
            int n = m->git_diff_files;
            snprintf(s, sizeof(s), "%d file%s", n, n == 1 ? "" : "s");
            break;
        }
        case BANNER_MODEL: {
            lv_label_set_text(blabel[slot], "MODEL");
            snprintf(h, sizeof(h), "%s", m->model_short[0] ? m->model_short : "Claude");
            if (m->has_ctx) {
                char tok[12], lim[12];
                fmt_k(tok, sizeof(tok), m->ctx_tokens);
                fmt_k(lim, sizeof(lim), m->ctx_limit);
                snprintf(s, sizeof(s), "%s / %s", tok, lim);
                if (m->ctx_exceeds_200k) sub_col = COL_USAGE_HIGH;
            }
            break;
        }
        case BANNER_COST: {
            lv_label_set_text(blabel[slot], "COST");
            snprintf(h, sizeof(h), "$%.2f", m->cost_session_usd);
            size_t off = 0;
            if (m->cost_burn_per_hr > 0)
                off += snprintf(s + off, sizeof(s) - off, "$%.1f/hr", m->cost_burn_per_hr);
            if (m->cost_duration_min > 0) {
                if (off) off += snprintf(s + off, sizeof(s) - off, "   ");
                if (m->cost_duration_min >= 60)
                    off += snprintf(s + off, sizeof(s) - off, "%.1fh", m->cost_duration_min / 60.0f);
                else
                    off += snprintf(s + off, sizeof(s) - off, "%dm", m->cost_duration_min);
            }
            break;
        }
        case BANNER_QUOTA: {
            lv_label_set_text(blabel[slot], "QUOTA");
            int mins = m->block_reset_in_min;
            if (mins >= 60) {
                int hh = mins / 60, mm = mins % 60;
                if (mm) snprintf(h, sizeof(h), "%dh %dm", hh, mm);
                else snprintf(h, sizeof(h), "%dh", hh);
            } else snprintf(h, sizeof(h), "%dm", mins);
            snprintf(s, sizeof(s), "5h block resets");
            break;
        }
        default: break;
    }
    lv_obj_set_style_text_color(bhero[slot], lv_color_hex(hero_col), 0);
    lv_label_set_text(bhero[slot], h);
    lv_obj_set_style_text_color(bsub[slot], lv_color_hex(sub_col), 0);
    lv_label_set_text(bsub[slot], s);
}

// Whether a card has data to show this frame (gate from the spec).
static bool banner_card_avail(int id, const model_t *m) {
    switch (id) {
        case BANNER_GIT: return m->has_git && (m->git_repo[0] || m->git_branch[0]);
        case BANNER_DIFF: return m->has_git && m->git_diff_files > 0;
        case BANNER_MODEL: return m->model_short[0] || m->has_ctx;
        case BANNER_COST: return m->has_cost;
        case BANNER_QUOTA: return m->has_block;
        default: return false;
    }
}

// Fill `ids` with the available card ids in rotation order; return the count.
static int banner_avail(const model_t *m, int *ids) {
    int n = 0;
    for (int id = 0; id < N_BANNER; id++)
        if (banner_card_avail(id, m)) ids[n++] = id;
    return n;
}

// Odometer roll: front card slides up & out, back card rolls up into place.
static void banner_anim_cb(void *var, int32_t v) {
    (void)var;
    lv_obj_set_y(bcard[s_banner_front], -v);
    lv_obj_set_y(bcard[1 - s_banner_front], BANNER_H - v);
}

static void banner_anim_done(lv_anim_t *a) {
    (void)a;
    int back = 1 - s_banner_front;
    lv_obj_set_y(bcard[s_banner_front], BANNER_H); // park old front below
    lv_obj_set_y(bcard[back], 0);                  // promote back into view
    s_banner_front = back;
    s_banner_anim = false;
}

// Snap to a card with no animation (used when the current card vanishes).
static void banner_show(int id, const model_t *m) {
    fill_banner_card(s_banner_front, id, m);
    lv_obj_set_y(bcard[s_banner_front], 0);
    s_banner_cur = id;
}

// Start an animated roll from the current card to `next_id`.
static void banner_advance(int next_id, const model_t *m) {
    int back = 1 - s_banner_front;
    fill_banner_card(back, next_id, m);
    lv_obj_set_y(bcard[back], BANNER_H); // start parked just below
    s_banner_cur = next_id;
    s_banner_anim = true;
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, &s_banner_anim_var);
    lv_anim_set_exec_cb(&a, banner_anim_cb);
    lv_anim_set_values(&a, 0, BANNER_H);
    lv_anim_set_duration(&a, BANNER_ANIM_MS);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out);
    lv_anim_set_ready_cb(&a, banner_anim_done);
    lv_anim_start(&a);
}

// Re-arm on (re)entering the live view: cancel any in-flight roll, reset card
// positions, restart the dwell clock.
static void banner_reset(void) {
    lv_anim_delete(&s_banner_anim_var, banner_anim_cb);
    s_banner_anim = false;
    lv_obj_set_y(bcard[s_banner_front], 0);
    lv_obj_set_y(bcard[1 - s_banner_front], BANNER_H);
    s_banner_last_ms = esp_timer_get_time() / 1000;
}

static void build_banner_card(int slot) {
    lv_obj_t *c = lv_obj_create(banner);
    lv_obj_remove_style_all(c);
    lv_obj_remove_flag(c, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(c, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(c, BANNER_W, BANNER_H);
    lv_obj_set_x(c, 0);
    lv_obj_set_flex_flow(c, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(c, GAP_TIGHT, 0);

    lv_obj_t *lab = lv_label_create(c);
    label_set(lab, &lv_font_montserrat_16, COL_DIM);
    label_fixed(lab, BANNER_W);
    lv_label_set_text(lab, "");

    lv_obj_t *hero = lv_label_create(c);
    label_set(hero, &lv_font_montserrat_28, COL_WHITE);
    label_fixed(hero, BANNER_W);
    lv_label_set_text(hero, "");

    lv_obj_t *sub = lv_label_create(c);
    label_set(sub, &lv_font_montserrat_16, COL_DIM);
    label_fixed(sub, BANNER_W);
    lv_label_set_text(sub, "");

    bcard[slot] = c;
    blabel[slot] = lab;
    bhero[slot] = hero;
    bsub[slot] = sub;
}

// Fixed-size info area; the two cards are positioned absolutely (set_y) and
// clipped to this box, so a roll only invalidates the banner's own rect.
static void build_banner(lv_obj_t *parent) {
    banner = lv_obj_create(parent);
    lv_obj_remove_style_all(banner);
    lv_obj_remove_flag(banner, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(banner, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_size(banner, BANNER_W, BANNER_H);
    build_banner_card(0);
    build_banner_card(1);
    lv_obj_set_y(bcard[0], 0);        // front (visible)
    lv_obj_set_y(bcard[1], BANNER_H); // back, parked below (clipped away)
}

// Banner's own driver: refreshes the visible card's values and rotates on the
// dwell timer. Decoupled from the live tick so it keeps rotating even when a
// steady-WORKING frame skips the full live refresh.
static void banner_tick_cb(lv_timer_t *t) {
    (void)t;
    if (s_view != VIEW_LIVE) return; // only animate while the live dashboard shows
    if (s_banner_anim) return;       // a roll is in flight

    model_lock();
    model_t m = g_model;
    model_unlock();

    int ids[N_BANNER];
    int n = banner_avail(&m, ids);
    if (n == 0) {
        set_hidden(banner, true);
        return;
    }
    set_hidden(banner, false);

    bool cur_ok = false;
    for (int i = 0; i < n; i++)
        if (ids[i] == s_banner_cur) { cur_ok = true; break; }
    if (!cur_ok) { // current card lost its data — snap to the first available
        banner_show(ids[0], &m);
        s_banner_last_ms = esp_timer_get_time() / 1000;
        return;
    }

    // Keep the visible card's values current (cheap; a no-op when text is equal).
    fill_banner_card(s_banner_front, s_banner_cur, &m);

    // ATTENTION freezes rotation; a single available card never rotates.
    if (m.activity == ACT_ATTENTION || n <= 1) {
        s_banner_last_ms = esp_timer_get_time() / 1000; // hold the dwell clock
        return;
    }

    int64_t now = esp_timer_get_time() / 1000;
    if (now - s_banner_last_ms >= BANNER_DWELL_MS) {
        int idx = 0;
        for (int i = 0; i < n; i++)
            if (ids[i] == s_banner_cur) { idx = i; break; }
        banner_advance(ids[(idx + 1) % n], &m);
        s_banner_last_ms = now;
    }
}

static void build_live_page(void) {
    live_page = make_page(GAP_SM);

    activity_lbl = lv_label_create(live_page);
    label_set(activity_lbl, &lv_font_montserrat_24, COL_WORKING);
    label_fixed(activity_lbl, LIVE_LBL_W);
    lv_label_set_text(activity_lbl, "ACTIVE");

    // Rotating info area between the activity label and the usage bars.
    build_banner(live_page);
    lv_obj_set_style_margin_top(banner, GAP_SM, 0);

    lv_obj_t *bars = lv_obj_create(live_page);
    lv_obj_remove_style_all(bars);
    lv_obj_remove_flag(bars, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_size(bars, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(bars, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(bars, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(bars, GAP_SM, 0);
    lv_obj_set_style_margin_top(bars, GAP_MD, 0);
    for (int i = 0; i < N_BARS; i++) build_bar_row(bars, i);

#if SHOW_FPS
    fps_lbl = lv_label_create(live_page);
    label_set(fps_lbl, &lv_font_montserrat_16, COL_DIM);
    lv_obj_set_style_margin_top(fps_lbl, GAP_SM, 0);
    // Fixed width + centered so the text changing each sample doesn't resize the
    // label and trigger a full-page flex relayout (which would itself repaint the
    // whole screen and skew the very FPS we're measuring).
    lv_obj_set_width(fps_lbl, 120);
    lv_obj_set_style_text_align(fps_lbl, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_text(fps_lbl, "");
#endif
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
    // Full-screen, touch-transparent container: taps on empty area fall through
    // to scr → ui_tap() returns to Live; long-press → BLE pairing. NOT
    // flex-centered — the title is pinned at top, the scrollable list below it.
    sess_page = lv_obj_create(scr);
    lv_obj_remove_style_all(sess_page);
    lv_obj_set_size(sess_page, DISP_SIZE, DISP_SIZE);
    lv_obj_center(sess_page);
    lv_obj_remove_flag(sess_page, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(sess_page, LV_OBJ_FLAG_CLICKABLE);

    sess_title = lv_label_create(sess_page);
    label_set(sess_title, &lv_font_montserrat_20, COL_DIM);
    lv_obj_set_width(sess_title, SESS_LIST_W);
    lv_obj_set_style_text_align(sess_title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(sess_title, LV_ALIGN_TOP_MID, 0, SESS_TITLE_TOP);
    lv_label_set_text(sess_title, "SESSIONS");

    // Phone-style vertical scroll with centre snap + auto scrollbar. SCROLLABLE
    // but NOT clickable: drag = scroll, a tap on empty list area falls through to
    // scr (returns to Live); only the cards are clickable (focus a session).
    lv_obj_t *list = lv_obj_create(sess_page);
    lv_obj_remove_style_all(list);
    lv_obj_set_size(list, SESS_LIST_W, SESS_LIST_H);
    lv_obj_align(list, LV_ALIGN_TOP_MID, 0, SESS_LIST_TOP);
    lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(list, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                          LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(list, 0, 0);                  // flush cards → continuous tap zone
    lv_obj_set_style_pad_ver(list, SESS_LIST_PAD_V, 0);
    lv_obj_add_flag(list, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(list, LV_DIR_VER);
    lv_obj_set_scroll_snap_y(list, LV_SCROLL_SNAP_CENTER);
    lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_AUTO);

    for (int i = 0; i < MODEL_MAX_SESSIONS; i++) {
        lv_obj_t *card = lv_obj_create(list);
        lv_obj_remove_style_all(card);
        lv_obj_set_size(card, SESS_CARD_W, SESS_CARD_H);
        lv_obj_set_style_radius(card, SESS_CARD_RADIUS, 0);
        // Selected state paints a sky tint + sky border (toggled in refresh);
        // unselected is fully transparent. Colours are fixed here, the bg opacity
        // and border width are flipped per-frame.
        lv_obj_set_style_bg_color(card, lv_color_hex(COL_SELECT), 0);
        lv_obj_set_style_bg_opa(card, LV_OPA_TRANSP, 0);
        lv_obj_set_style_border_color(card, lv_color_hex(COL_SELECT), 0);
        lv_obj_set_style_border_width(card, 0, 0);
        lv_obj_set_flex_flow(card, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(card, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER);
        lv_obj_set_style_pad_hor(card, SESS_CARD_PAD_X, 0);
        lv_obj_set_style_pad_column(card, SESS_CARD_COL_GAP, 0);
        lv_obj_add_flag(card, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(card, on_row_click, LV_EVENT_CLICKED, (void *)(intptr_t)i);

        // Activity dot: a solid colour disc (green/amber/red). The working one
        // breathes (opacity pulse); others stay solid.
        lv_obj_t *dot = lv_obj_create(card);
        lv_obj_remove_style_all(dot);
        lv_obj_remove_flag(dot, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_set_size(dot, SESS_DOT_D, SESS_DOT_D);
        lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_color(dot, lv_color_hex(COL_LINKED), 0);
        lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);

        lv_obj_t *nm = lv_label_create(card);
        label_set(nm, &lv_font_montserrat_28, COL_WHITE);
        lv_label_set_long_mode(nm, LV_LABEL_LONG_DOT);
        lv_obj_set_flex_grow(nm, 1);
        lv_label_set_text(nm, "");

        sess_row[i] = card;
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

    // Require a deliberate hold (LONG_PRESS_MS) before LV_EVENT_LONG_PRESSED
    // fires, so incidental touches don't toggle BLE pairing.
    for (lv_indev_t *id = lv_indev_get_next(NULL); id; id = lv_indev_get_next(id)) {
        if (lv_indev_get_type(id) == LV_INDEV_TYPE_POINTER) {
            lv_indev_set_long_press_time(id, LONG_PRESS_MS);
        }
    }

    // Even-align all partial writes for the CO5300 (prevents stale-pixel trails).
    lv_display_add_event_cb(lv_display_get_default(), area_rounder_cb, LV_EVENT_INVALIDATE_AREA,
                            NULL);

#if SHOW_FPS
    lv_display_add_event_cb(lv_display_get_default(), fps_render_ready_cb, LV_EVENT_RENDER_READY,
                            NULL);
#endif

    build_ring();
    build_spinner();
    build_live_page();
    build_idle_page();
    build_sessions_page();
    build_notify_page();
    build_pair_page();

    // Continuous, refresh-rate-smooth rotation of the spinner dot.
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, &s_anim_var);
    lv_anim_set_exec_cb(&a, spinner_anim_cb);
    lv_anim_set_values(&a, 0, 359);
    lv_anim_set_duration(&a, SPINNER_REV_MS);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_path_cb(&a, lv_anim_path_linear);
    lv_anim_start(&a);

    lv_timer_create(tick_cb, TICK_MS, NULL);
    // The banner rotates on its own clock, independent of the live tick, so it
    // keeps cycling even when a steady-WORKING frame skips the full live refresh.
    lv_timer_create(banner_tick_cb, BANNER_TICK_MS, NULL);
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

static void set_spinner_hidden(bool hide) { set_hidden(spinner, hide); }

static void update_ring(activity_t a) {
    set_hidden(ring, false);
    lv_obj_set_style_arc_color(ring, lv_color_hex(activity_color(a)), LV_PART_INDICATOR);
    float wave = sinf(s_pulse) * 0.5f + 0.5f; // 0..1
    if (a == ACT_WORKING) {
        // The spinner dot (animated separately) is the indicator; keep only the dim
        // track on `ring` underneath it.
        s_working = true;
        lv_arc_set_angles(ring, 0, 359);
        lv_arc_set_rotation(ring, 0);
        lv_obj_set_style_arc_opa(ring, LV_OPA_TRANSP, LV_PART_INDICATOR);
        set_spinner_hidden(false);
        update_spinner(s_spin);
    } else {
        s_working = false;
        set_spinner_hidden(true);
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

    lv_obj_set_style_text_color(activity_lbl, lv_color_hex(activity_color(m->activity)), 0);
    lv_label_set_text(activity_lbl, activity_text(m->activity));
    update_ring(m->activity);

    // The model/cost/diff/git readouts now live in the auto-rotating banner,
    // driven independently by banner_tick_cb. Here we only own the anchored
    // activity label, the ring, and the three permanent usage bars.
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

    // Shared breathing phase for working sessions (s_pulse advances each tick).
    float wave = sinf(s_pulse) * 0.5f + 0.5f; // 0..1
    lv_opa_t pulse = (lv_opa_t)(PULSE_RING_BASE + (int)(wave * PULSE_RING_SPAN));

    int sel = 0; // 1-based index of the selected session (0 = none)
    for (int i = 0; i < MODEL_MAX_SESSIONS; i++) {
        if (i < m->session_count) {
            const session_t *s = &m->sessions[i];
            snprintf(s_row_id[i], sizeof(s_row_id[i]), "%s", s->id);
            lv_obj_set_style_bg_color(sess_dot[i],
                                      lv_color_hex(activity_color(s->activity)), 0);
            // Working breathes (opacity pulse); other states stay solid.
            lv_obj_set_style_bg_opa(sess_dot[i],
                                    s->activity == ACT_WORKING ? pulse : LV_OPA_COVER, 0);
            lv_label_set_text(sess_name[i], s->name[0] ? s->name : s->id);
            // Selected: sky tint fill + 3px sky border (obvious on true black);
            // unselected: transparent, no border.
            lv_obj_set_style_bg_opa(sess_row[i], s->selected ? LV_OPA_30 : LV_OPA_TRANSP, 0);
            lv_obj_set_style_border_width(sess_row[i], s->selected ? 3 : 0, 0);
            lv_obj_set_style_text_color(sess_name[i],
                                        lv_color_hex(s->selected ? COL_WHITE : COL_DIM), 0);
            set_hidden(sess_row[i], false);
            if (s->selected) sel = i + 1;
        } else {
            s_row_id[i][0] = '\0';
            set_hidden(sess_row[i], true);
        }
    }

    char t[32];
    if (sel > 0) snprintf(t, sizeof(t), "SESSIONS  %d/%d", sel, m->session_count);
    else snprintf(t, sizeof(t), "SESSIONS  %d", m->session_count);
    lv_label_set_text(sess_title, t);
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
    s_working = false; // pause spinner updates until update_ring re-arms it
    set_spinner_hidden(true);
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

    s_pulse += (m.activity == ACT_ATTENTION) ? 0.45f : 0.22f;

#if SHOW_FPS
    {
        static int64_t fps_last_us = 0;
        static uint32_t fps_last_frames = 0;
        int64_t now_us = esp_timer_get_time();
        if (fps_last_us == 0) {
            fps_last_us = now_us;
            fps_last_frames = s_fps_frames;
        } else if (now_us - fps_last_us >= 500000) {
            uint32_t df = s_fps_frames - fps_last_frames;
            s_fps = (int)(((uint64_t)df * 1000000ULL) / (uint64_t)(now_us - fps_last_us));
            fps_last_frames = s_fps_frames;
            fps_last_us = now_us;
            if (fps_lbl) {
                char f[16];
                snprintf(f, sizeof(f), "%d FPS", s_fps);
                lv_label_set_text(fps_lbl, f);
            }
        }
    }
#endif

    static int last_bright = -1;
    int want = (m.link == LINK_NOLINK) ? BRIGHT_IDLE : BRIGHT_ACTIVE;
    if (want != last_bright) {
        bsp_display_brightness_set(want);
        last_bright = want;
    }

    // Auto-dismiss a low/normal notify once its timeout elapses.
    bool show_notify = m.notify_active;
    if (m.notify_active && m.notify_urgency != URG_HIGH &&
        (esp_timer_get_time() / 1000 - m.notify_shown_ms) > NOTIFY_AUTO_MS) {
        model_lock();
        g_model.notify_active = false;
        model_unlock();
        show_notify = false;
    }

    // Decide the target view first. Pairing takes over the screen (no host link
    // yet anyway); then notify; then the live dashboard / session list / idle.
    view_t target;
    if (m.ble_state == BLE_UI_PAIRING) {
        target = VIEW_PAIR;
    } else if (show_notify) {
        target = VIEW_NOTIFY;
    } else if (m.link == LINK_LIVE && s_page == PAGE_SESSIONS && m.session_count > 0) {
        target = VIEW_SESSIONS;
    } else if (m.link == LINK_LIVE) {
        if (s_page == PAGE_SESSIONS) s_page = PAGE_LIVE;
        target = VIEW_LIVE;
    } else {
        target = VIEW_IDLE;
    }

    // Only hide/show pages on an actual transition.
    bool transitioned = (target != s_view);
    if (transitioned) {
        hide_all_pages();
        s_view = target;
        // Re-arm the banner whenever the live dashboard (re)appears: cancel any
        // stale roll, reset card positions, restart the dwell clock.
        if (target == VIEW_LIVE) banner_reset();
    }

    // Steady LIVE states need no per-tick page work: WORKING's spinner dot
    // animates on its own lv_anim, and AWAITING / linked-idle are fully static.
    // Re-running refresh_live would re-touch the full-rim arc (angles + opacity)
    // every tick, invalidating the whole 458px ring bounding box → a near
    // full-screen repaint on the GPU-less rasterizer (the dominant FPS killer)
    // with nothing actually changing on screen. Only ATTENTION genuinely animates
    // per tick (its ring opacity pulses via s_pulse), so it still refreshes. New
    // data (m.dirty) or a view transition always forces a refresh. The banner
    // rotates on its own timer regardless.
    bool steady_live =
        (target == VIEW_LIVE && m.activity != ACT_ATTENTION && !transitioned && !m.dirty);
    if (!steady_live) {
        switch (target) {
            case VIEW_PAIR: refresh_pair(&m); break;
            case VIEW_NOTIFY: refresh_notify(&m); break;
            case VIEW_SESSIONS: refresh_sessions(&m); break;
            case VIEW_LIVE: refresh_live(&m); break;
            case VIEW_IDLE: refresh_idle(&m); break;
            default: break;
        }
    }
}
