# Screenshot: raw RGB565, host-side PNG

`m5ct screenshot [-o <path>]` saves the device screen as PNG to `~/.m5stack-coding-toys/screenshots/<UTC-ts>.png`.

Flow: CLI → control socket `{op:'screenshot',out?}` → running daemon (NOT restarted, serial not re-grabbed) → `DeviceSession.request({k:'screenshot',p:{fmt:'png'}},5s)` → device streams the frame → daemon encodes PNG host-side → writes file.

## Why on-device PNG is unusable on ESP32-S3

This is why encoding moved host-side:

- `sprite_.createPng(&len)` returns null because the default 0 extent is treated as invalid (must pass explicit w/h).
- Even with w/h, miniz's ~380KB deflate runs against PSRAM and a full 320×240 encode NEVER returns in 180s.
- A 204KB base64 string won't fit the ESP32 internal heap (`std::string` uses internal heap).

## As built

The device exposes the off-screen sprite's raw **big-endian RGB565** buffer via `Canvas::rawFrame()` (zero-copy `sprite_.getBuffer()`); `App` base64-**streams** it in chunks to serial (`m5proto::base64EncodeStream` in `base64.h`). Ack payload is `{ok,w,h,fmt:"rgb565",data_b64}`.

Daemon `src/png.ts` decodes big-endian RGB565 → PNG (Node built-in `zlib` + hand-rolled PNG chunks/CRC, no new dep) in `control-ops.screenshot`. CoreS3 native USB-CDC ignores nominal baud → 153.6KB transfers in ~754ms; HW-verified on CoreS3 SE, PNG ~2KB (flat UI compresses well). Cardputer: `rawFrame` default returns false → `capture_unsupported`.

See also: [adding-a-host-device-rpc.md](adding-a-host-device-rpc.md), [firmware-hardware-gotchas.md](firmware-hardware-gotchas.md).
