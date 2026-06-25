# Waveshare round-AMOLED — Claude statusbar firmware

A third hardware target for the m5stack-coding-toys statusbar, on the
**Waveshare ESP32-S3-Touch-AMOLED-1.75** (1.75″ **466×466 round** AMOLED, CO5300
QSPI panel, CST9217 touch). It speaks the exact same `m5ct` NDJSON protocol as
the M5Stack boards — **no host (daemon/CLI/protocol) changes were needed** — but
ships a UI redesigned from scratch for a circular, true-black OLED.

> Unlike the other two boards (`firmware/`, PlatformIO + Arduino/M5Unified), this
> target is **ESP-IDF v5.5 + LVGL 9** on the official Waveshare BSP, because that
> is the only supported stack for this panel. Hence it lives in `firmware-idf/`.

## The "Halo" UI

Everything is concentric on a black background (AMOLED pixels off → deep
contrast, low power). Three link states drive the layout:

- **No link / linked-idle** — a calm clock face: big `HH:MM`, date, and a status
  pill (`NO LINK` grey / `LINKED · <model>` green). Screen dims at no-link.
- **Live** (active Claude session) — the dashboard:
  - **Outer ring** = context-window usage, colour-graded sky→amber→red (red also
    when >200k).
  - **Inner thin ring** = 5-hour block usage.
  - **Centre orb** = the activity beacon, colour + breathing speed encode state:
    cyan/slow = working, amber = awaiting input, red/fast = needs attention.
  - Model pill (top), big primary metric (`$cost`, or context % if no cost),
    a `ctx · duration · +/-lines` subline, and a git `branch  N*` footer.
- **Sessions page** — tap the screen (when >1 session) to flip to a list of
  sessions with per-session activity dots; tapping one sends a `focus` event so
  the host foregrounds it. Tap empty space to flip back.
- **Notify overlay** — host `notify` shows a full-screen pulsing halo (red=high)
  with title/body; tap to dismiss (low/normal auto-dismiss after 8s).

## Protocol

Standard `m5ct` envelope `{v,k,t,p,id?}`, NDJSON framed, over the chip's native
**USB-Serial/JTAG** port. Implemented in `main/proto.c`:

- replies to `hello` (→ `hello.ack` with `board/fw/caps/device_id`, applies the
  host time), `ping` (→ `pong`)
- parses `status` into `g_model` (see `main/model.h`) for the UI
- `notify` → overlay + `notify.ack`; `tap` → `tap.ack`
- `screenshot` → raw **big-endian RGB565** frame, base64-streamed in the ack
  (host encodes the PNG). Downsampled 4× (116×116) so the whole frame streams
  inside the host's 5 s request timeout.
- sends `device.event {kind:focus,…}` on session taps.

`device_id` is `WAVE-<MAC>` (e.g. `WAVE-288485551DBC`).

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
