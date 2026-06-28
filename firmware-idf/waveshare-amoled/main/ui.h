// Round-AMOLED UI for the Claude statusbar on a true-black background: an outer
// bezel ring that animates the activity (working spinner / awaiting / attention)
// and horizontal usage bars for context, block, and weekly budgets. Built once,
// repainted from g_model on a timer.
#pragma once

#include <stdbool.h>

// Build the widget tree. Must be called while holding the LVGL adapter lock.
void ui_init(void);

// Mimic a screen tap from the host `tap` RPC: dismiss an active notify, else
// flip between the live dashboard and the session list. Safe to call off the
// LVGL task (only mutates g_model under its lock and the page-state int).
void ui_tap(void);

// BOOT physical-button session picker. Same off-LVGL-task safety as ui_tap.
// short = open the picker (or step the highlight cursor if already open);
// confirm = focus the highlighted session and return to the live page.
void ui_picker_open(void);
void ui_picker_next(void);
void ui_picker_short(void);
void ui_picker_confirm(void);

// Capture the current screen at full resolution into a freshly malloc'd
// big-endian RGB565 buffer (caller frees with free()). Returns false if the
// snapshot or allocation fails. Output dims are written to *ow/*oh.
bool ui_capture_take(unsigned char **out, int *ow, int *oh);
