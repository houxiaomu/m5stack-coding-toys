# Waveshare round-AMOLED — Claude statusbar firmware

A third hardware target for the m5stack-coding-toys statusbar, on the
**Waveshare ESP32-S3-Touch-AMOLED-1.75** (1.75″ **466×466 round** AMOLED, CO5300
QSPI panel, CST9217 touch). It speaks the exact same `m5ct` NDJSON protocol as
the M5Stack boards — **no host (daemon/CLI/protocol) changes were needed** — but
ships a UI redesigned from scratch for a circular, true-black OLED.

> Unlike the other two boards (`firmware/`, PlatformIO + Arduino/M5Unified), this
> target is **ESP-IDF v5.5 + LVGL 9** on the official Waveshare BSP, because that
> is the only supported stack for this panel. Hence it lives in `firmware-idf/`.

## UI

Flat colour on true black (AMOLED pixels off → deep contrast, low power). All
elements are solid fills + text — no gradients or soft shadows, which avoids
RGB565 colour-banding. Three link states drive the layout:

- **No link / linked-idle** — a calm clock face: big `HH:MM`, date, and a status
  pill (`NO LINK` grey / `LINKED · <model>` green). Screen dims at no-link.
- **Live** (active Claude session) — the dashboard:
  - **Outer bezel ring** = the activity animation. **Working** sweeps a bright
    cyan segment around the rim (spinner); **awaiting** is a calm full amber
    ring; **needs-attention** is a pulsing full red ring.
  - **Activity label** in the activity colour (WORKING / AWAITING / ATTENTION).
  - Model pill (top), big `$cost` (or context % if no cost), a
    `duration · +/-lines` subline.
  - **Three horizontal usage bars** — `CTX` (context window), `5H` (5-hour
    block), `WK` (weekly), each colour-graded sky→amber→red by fill.
  - Git `branch  N*` footer.
- **Sessions page** — tap the screen (when >1 session) to flip to a list of
  sessions with per-session activity dots; tapping one sends a `focus` event so
  the host foregrounds it. Tap empty space to flip back.
- **Notify overlay** — host `notify` shows a full-screen pulsing ring (red=high)
  with title/body; tap to dismiss (low/normal auto-dismiss after 8s).

## Protocol

Standard `m5ct` envelope `{v,k,t,p,id?}`, NDJSON framed, over the chip's native
**USB-Serial/JTAG** port. Implemented in `main/proto.c`:

- replies to `hello` (→ `hello.ack` with `board/fw/caps/device_id`, applies the
  host time), `ping` (→ `pong`)
- parses `status` into `g_model` (see `main/model.h`) for the UI
- `notify` → overlay + `notify.ack`; `tap` → mirrors a physical screen tap
  (dismiss the notify overlay, else flip live ⇄ sessions) + `tap.ack`
- `screenshot` → raw **big-endian RGB565** frame, base64-streamed in the ack
  (host encodes the PNG). Full 466×466 streams in ~0.9 s (well inside the host's
  5 s timeout) thanks to chunked TX; `ui.c`'s `sf` can downsample if ever needed.
- sends `device.event {kind:focus,…}` on session taps.

`device_id` is `WAVE-<MAC>` (e.g. `WAVE-288485551DBC`).

## BLE transport (secondary)

The same `m5ct` NDJSON protocol also runs over **BLE** (NimBLE peripheral,
`main/ble.c`), so the daemon connects over Bluetooth when there's no USB data
link to that host. Same GATT contract as CoreS3 SE — **no daemon/CLI/protocol
logic changes**; the host only needs the `@abandonware/noble` optional dependency
installed (already declared in the daemon + CLI packages).

- Service `7d9a0000-…`, RX `…0001` (write), TX `…0002` (notify), Info `…0003`
  (read, JSON `{v,board,fw,device_id,pairing[,pair_code]}`).
- Advertises `m5ct-<device_id>` (service UUID in the adv packet, name in the scan
  response — a 128-bit UUID + name won't both fit in 31 bytes).
- **Long-press** the screen to enter pairing: advertises `…-PAIR`, shows a 6-digit
  code, exits on connect or after 5 min. `m5ct pair` binds it as the default.
- `proto.c` muxes USB + BLE: replies go back out the link a frame arrived on;
  USB wins when both are live. The daemon also outranks BLE with serial when a
  USB data link exists, so BLE is the cross-device / cable-free path.

### BLE gotchas (don't regress)

- **TX and RX are byte streams; frame on `\n`.** A central's write larger than
  `ATT_MTU-3` is truncated, so the host must chunk (the daemon's `BleTransport`
  uses 180 B). The device side accumulates RX bytes and frames lines itself.
- **Console stays on UART0.** NimBLE host logs would corrupt the protocol if they
  hit the USB-Serial/JTAG port — same reason the console is off USB.
- **Screenshots over BLE work but are slow** (~28 s for the full 466×466 frame at
  BLE throughput), past the host's 5 s screenshot timeout — screenshots are a USB
  feature in practice. The status/notify/tap path is small and snappy over BLE.

## Build & flash

```bash
. ~/esp/esp-idf/export.sh           # ESP-IDF v5.5 (py3.13 venv)
cd firmware-idf/waveshare-amoled
idf.py build
idf.py -p /dev/cu.usbmodem1101 -b 921600 flash
```

If the m5ct daemon is running it owns the serial port; release it first over the
control socket (`{op:"flashHold",client:"x"}` … `{op:"flashRelease",client:"x"}`)
or just `pkill -f m5ctd` before flashing.

Prebuilt binaries + manifest for `m5ct flash` live in
`firmware/dist/waveshare-amoled/` (board id `waveshare-amoled`, fw `1.0.0`).

## Hard-won gotchas (don't regress these)

- **Console must NOT share the USB-Serial/JTAG port.** That port is the protocol
  channel; any `ESP_LOGx` on it corrupts NDJSON framing. `sdkconfig.defaults`
  routes the console to **UART0** (GPIO43/44) and we drive USB ourselves.
- **`lv_snapshot` needs a big stack.** The protocol RX task runs it; at 6 KB it
  silently corrupted/failed (5 s screenshot timeouts). It runs in ~20 ms with a
  **16 KB** task stack.
- **USB-Serial/JTAG TX must be chunked.** Large `usb_serial_jtag_write_bytes`
  bursts were dropped (empty `data_b64`). We stream base64 in ≤1 KB chunks with a
  retrying `write_all` and an 8 KB TX ring.
- **LVGL allocator → CLIB malloc.** The 64 KB builtin LVGL pool can't hold a
  466×466 snapshot; `CONFIG_LV_USE_CLIB_MALLOC` routes it to PSRAM-backed malloc.

## Layout

| File | Role |
|------|------|
| `main/app_main.c` | NVS, I2C, BSP display/touch/LVGL bring-up, starts proto + UI |
| `main/proto.c/.h` | USB-Serial/JTAG transport, NDJSON + cJSON, link state machine, screenshot |
| `main/ui.c/.h`    | the round "Halo" LVGL UI + `lv_snapshot` capture |
| `main/model.h/.c` | shared status model + mutex (proto writer ↔ UI reader) |
| `partitions.csv`  | nvs + phy + 4 MB factory app (32 MB flash) |
