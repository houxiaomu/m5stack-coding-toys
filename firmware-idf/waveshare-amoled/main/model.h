// Shared status model: the single hand-off point between the protocol task
// (proto.c, writer) and the LVGL UI task (ui.c, reader). All access is guarded
// by model_lock()/model_unlock(); the writer flips `dirty` and the UI timer
// repaints on the next tick. Nothing here calls LVGL — keeps the threads clean.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define MODEL_MAX_SESSIONS 8

typedef enum {
    LINK_NOLINK = 0, // no host bytes for a while — show the idle face
    LINK_LINKED,     // handshook + host present, but no active Claude session
    LINK_LIVE,       // an active Claude session is streaming status
} link_state_t;

typedef enum {
    ACT_NONE = 0,
    ACT_WORKING,
    ACT_AWAITING,   // awaiting_input
    ACT_ATTENTION,  // needs_attention
} activity_t;

typedef enum {
    URG_LOW = 0,
    URG_NORMAL,
    URG_HIGH,
} urgency_t;

typedef enum {
    BLE_UI_OFF = 0,   // radio not up yet
    BLE_UI_READY,     // advertising, not connected
    BLE_UI_PAIRING,   // advertising in pairing mode, code shown
    BLE_UI_CONNECTED, // a central is connected over BLE
} ble_ui_state_t;

typedef struct {
    int index;
    char id[24];
    char name[40];
    activity_t activity;
    bool selected;
} session_t;

typedef struct {
    link_state_t link;
    int64_t last_rx_ms; // esp_timer ms of the last decoded host frame

    char model_short[24];
    activity_t activity;

    // context window usage
    bool has_ctx;
    int ctx_used_pct;
    int ctx_tokens;
    int ctx_limit;
    bool ctx_exceeds_200k;

    // cost / session economics
    bool has_cost;
    float cost_session_usd;
    float cost_burn_per_hr;
    int cost_duration_min;
    int lines_added;
    int lines_removed;

    // 5h block + weekly quota
    bool has_block;
    int block_used_pct;
    int block_reset_in_min;
    bool has_weekly;
    int weekly_used_pct;

    // workspace (Claude Code session cwd) — basename used as a project-name
    // fallback when git.repo is absent (older daemon).
    char ws_name[40];

    // git
    bool has_git;
    char git_branch[40];
    char git_repo[40]; // repo-root dir name (project identity)
    int git_staged;
    int git_unstaged;
    int git_untracked;
    // working-tree diff (git diff --numstat, staged + unstaged): files & lines
    // from one source so they always agree. All 0 when the tree is clean.
    int git_diff_files;
    int git_diff_added;
    int git_diff_removed;

    // multi-session picker
    int session_count;
    session_t sessions[MODEL_MAX_SESSIONS];

    // battery (AXP2101 PMIC, read on-device — independent of the host link)
    bool has_battery;   // a battery is present and the gauge reads valid
    int batt_pct;       // 0..100 state-of-charge
    bool batt_charging; // true while charging from VBUS

    // BLE transport state (for the pairing screen + a link glyph)
    ble_ui_state_t ble_state;
    char pair_code[7];

    // notify overlay (host -> device)
    bool notify_active;
    int64_t notify_shown_ms;
    urgency_t notify_urgency;
    char notify_title[80];
    char notify_body[240];

    bool dirty; // set by writer; cleared by UI after repaint
} model_t;

extern model_t g_model;

void model_init(void);
void model_lock(void);
void model_unlock(void);
