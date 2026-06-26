// m5ct BLE GATT transport for the round board (ESP-IDF NimBLE peripheral).
// Mirrors the CoreS3 SE BLE contract so the existing daemon discovers, pairs,
// and reconnects with no host changes:
//   service 7d9a0000-…  RX …0001 (write)  TX …0002 (notify)  Info …0003 (read)
// Bytes are a raw NDJSON stream in both directions; framing lives in proto.c.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Bring up the NimBLE stack and start advertising as "m5ct-<device_id>".
// Strings must stay valid for the program's lifetime (they do — static in proto).
void ble_start(const char *device_id, const char *board, const char *fw);

// True while a central is connected over BLE.
bool ble_connected(void);

// Drain received bytes from the RX stream buffer (non-blocking). Returns the
// number of bytes copied into buf (0 if none).
int ble_read(uint8_t *buf, size_t n);

// Notify the TX characteristic with buf, chunked to the negotiated MTU.
// Returns bytes sent (0 if not connected/subscribed).
int ble_write(const uint8_t *buf, size_t n);

// Toggle pairing mode: generate a fresh 6-digit code, re-advertise as
// "m5ct-<device_id>-PAIR", and surface it on the UI. Calling again exits.
void ble_toggle_pairing(int64_t now_ms);

// True while advertising in pairing mode.
bool ble_pairing_active(void);

// Periodic housekeeping (call from the proto RX loop): auto-exits pairing after
// a timeout or once a central connects.
void ble_tick(int64_t now_ms);
