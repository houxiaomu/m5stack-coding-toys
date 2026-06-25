// m5ct NDJSON protocol over the ESP32-S3 native USB-Serial/JTAG port.
// Speaks the same wire protocol as the M5Stack boards: replies to hello/ping,
// parses status snapshots into g_model, and surfaces notify overlays.
#pragma once

#include <stdint.h>

// Firmware identity reported in hello.ack and the manifest.
#define FW_BOARD "waveshare-amoled"
#define FW_VERSION "1.0.0"

// Start the USB-Serial/JTAG driver and the protocol RX task.
void proto_start(void);

// Send an unsolicited focus event so the host foregrounds a session.
// Safe to call from the LVGL/UI task; TX is mutex-guarded.
void proto_send_focus(const char *session_id);
