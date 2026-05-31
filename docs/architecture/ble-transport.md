# BLE transport architecture

BLE is an additional host/device byte-stream transport. It does not change the
NDJSON protocol: `DeviceSession` still owns hello, ping, request ids, and
unsolicited device events.

## Current implemented slice

- CLI device binding storage lives in `~/.m5stack-coding-toys/devices.json`.
- `m5ct devices`, `m5ct use`, and `m5ct unpair` manage that store.
- `m5ct pair` uses the real backend path by default. The macOS BLE backend is
  isolated behind `BleCentral` and dynamically loads optional
  `@abandonware/noble`; tests use a fake central and fake noble module.
- daemon status now reports `transport`, `transport_label`, `reconnecting`, and
  `default_device_id`.
- daemon reads the default paired device, scans for its BLE advertisement, and
  can auto-connect over BLE. Serial candidates keep higher priority and can
  override an active BLE session.
- BLE transport implements a chunked byte-stream wrapper over a `BleLink`.
- `m5ct screenshot` is intentionally rejected over BLE; use USB for screenshots.
- CoreS3 SE firmware exposes a NimBLE GATT byte-stream transport behind
  `TransportMux(serial, ble)` and supports long-press pairing mode on the
  waiting screen.

## Boundaries

USB serial remains the recovery, flashing, screenshot, and highest-confidence
debug path. BLE is for day-to-day status display once a device is bound.

Transport source is daemon/control metadata, not protocol capability. Do not add
`ble` to protocol `CAPS`; those describe device hardware such as display,
buttons, touch, haptic, and notify support.

## Hardware follow-up

CoreS3 SE hardware validation is still required before claiming the branch fully
done:

- confirm `m5ct pair` works without macOS Bluetooth Settings device pairing;
- confirm a paired default device reconnects over BLE after USB is unplugged;
- confirm USB can still take over for `m5ct flash` and screenshots.

Cardputer ADV BLE and Linux/Windows BLE are outside this slice.
