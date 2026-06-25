// Round-AMOLED "Halo" UI for the Claude statusbar. Concentric rings on a true
// black background: an outer context-usage ring, a breathing activity orb, and
// glanceable session economics. Built once, repainted from g_model on a timer.
#pragma once

#include <stdbool.h>

// Build the widget tree. Must be called while holding the LVGL adapter lock.
void ui_init(void);

// Capture the current screen, downsampled 2x, into a freshly malloc'd
// big-endian RGB565 buffer (caller frees with free()). Returns false if the
// snapshot or allocation fails. Output dims are written to *ow/*oh.
bool ui_capture_take(unsigned char **out, int *ow, int *oh);
