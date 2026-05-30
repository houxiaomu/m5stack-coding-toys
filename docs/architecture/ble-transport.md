# BLE transport architecture

BLE is an additional host/device byte-stream transport. It does not change the
NDJSON protocol: `DeviceSession` still owns hello, ping, request ids, and
unsolicited device events.

## Current implemented slice

- CLI device binding storage lives in `~/.m5stack-coding-toys/devices.json`.
- `m5ct devices`, `m5ct use`, and `m5ct unpair` manage that store.
- `m5ct pair` has the command and pairing orchestration path, with a fake BLE
  central used in tests. The real macOS BLE backend remains isolated behind the
  `BleCentral` interface and a dynamic noble loader shell.
- daemon status now reports `transport`, `transport_label`, `reconnecting`, and
  `default_device_id`.
- BLE transport implements a chunked byte-stream wrapper over a `BleLink`.
- `m5ct screenshot` is intentionally rejected over BLE; use USB for screenshots.
- firmware has stable readable device ids and a tested `TransportMux`
  foundation for serial/BLE coexistence.

## Boundaries

USB serial remains the recovery, flashing, screenshot, and highest-confidence
debug path. BLE is for day-to-day status display once a device is bound.

Transport source is daemon/control metadata, not protocol capability. Do not add
`ble` to protocol `CAPS`; those describe device hardware such as display,
buttons, touch, haptic, and notify support.

## Hardware follow-up

CoreS3 SE hardware validation is still required before claiming real BLE support:

- wire the real noble central to Core Bluetooth behavior on macOS;
- add the firmware GATT server transport using the tested mux boundary;
- confirm `m5ct pair` works without macOS Bluetooth Settings device pairing;
- confirm USB can still take over for `m5ct flash` and screenshots.
