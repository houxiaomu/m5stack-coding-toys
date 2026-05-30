---
name: m5stack-cores3-bring-up
description: Use when flashing firmware to M5Stack CoreS3 or CoreS3 SE via PlatformIO, debugging native USB CDC silent failures, recovering from "Could not configure port" errors, or coordinating physical button presses with a human partner during ESP32-S3 bring-up
---

# M5Stack CoreS3 / CoreS3 SE Bring-Up

## Overview

ESP32-S3 + native USB CDC + a pre-flashed UiFlow2 firmware creates a flashing experience where standard `pio run -t upload` *silently does the wrong thing* the first time, and the default RTS hard reset after upload is unreliable. The agent cannot solve download-mode entry alone — it requires a tight loop of "agent does software step → asks human for a specific physical action → verifies → continues". This skill captures both the **specific gotchas** and the **coordination pattern**.

**Core principle:** treat physical hardware steps as a tool you call through the human. Each request must be a single, unambiguous physical action with a verifiable success criterion.

## When to Use

- Flashing a CoreS3 / CoreS3 SE for the first time (UiFlow2 still on board)
- `esptool` reports `Could not configure port: (6, 'Device not configured')`
- Flashed firmware shows nothing on the LCD / no serial output
- `/dev/cu.usbmodem*` keeps appearing and disappearing
- After successful flash, board "doesn't boot" (it just needs a manual reset)
- Two different serial port names appear depending on USB mode (`usbmodem1101` vs `usbmodem<HEX-SERIAL>`)
- Host→device serial messages silently dropped while device→host works (or vice versa)

## The Bring-Up Dance

```
Agent: build firmware
Agent: ask human → "double-tap reset" OR "hold reset 3s, green LED blinks once"
Human: "download mode"
Agent: pio upload --upload-port /dev/cu.usbmodem1101   ← seize the window NOW
Agent: esptool.py --port /dev/cu.usbmodem1101 --after watchdog_reset run
Agent: verify on serial (heartbeat / hello round-trip)
```

If any step fails, go back to "ask human to enter download mode again" — don't try to recover via more software.

## Download Mode Entry (CoreS3 / CoreS3 SE)

Confirmed working method:
1. **Hold the reset button for ~3 seconds**
2. **Green LED next to reset blinks once**
3. **Screen stays black**
4. `ls /dev/cu.usbmodem1101` succeeds and the port is stable (not disappearing)

The G0 (BOOT) pin is *inside the back cover* — not user-accessible. Long-press reset is the documented dance.

## Critical Build Flags (`platformio.ini`)

```ini
[env:cores3-se]
platform = espressif32
board = m5stack-cores3
build_flags =
    -DBOARD_CORES3_SE
    -DARDUINO_USB_CDC_ON_BOOT=1
    -DARDUINO_USB_MODE=1     ; HWCDC (USB-Serial-JTAG endpoint)
```

| Flag combination | Serial port on host | Re-flash works? |
|---|---|---|
| `USB_CDC_ON_BOOT=1` + `USB_MODE=1` | `/dev/cu.usbmodem1101` (stable across reboot) | ✅ yes |
| `USB_CDC_ON_BOOT=1` + `USB_MODE=0` | `/dev/cu.usbmodem<HEX_SERIAL>` (changes; TinyUSB CDC) | ❌ esptool can't reach bootloader |
| Neither flag | `Serial` is UART0 — no pins exposed on CoreS3 | ❌ no serial at all |

**Always use `USB_MODE=1` for development.** TinyUSB CDC creates a separate USB endpoint that esptool can't push into download mode without manual G0.

## Code-Level Pitfalls

### Default RTS reset is unreliable; watchdog reset works after flashing
esptool's default `Hard resetting via RTS pin...` path can leave CoreS3 SE in ROM/stub mode. After a successful upload, use the ESP32-S3 watchdog reset path to boot the app:
```bash
esptool.py --port /dev/cu.usbmodem1101 --after watchdog_reset run
```
This was hardware-verified on CoreS3 SE: after upload, `watchdog_reset` returned the daemon to `Connected` without a manual RESET press. It does **not** enter download mode; long-press RESET is still required before flashing.

### `delay(2000)` after `M5.begin()` in `setup()`
Give USB CDC ~2 s to enumerate before initializing your dispatcher / transport. Without it, early host→device bytes are lost.

### Timestamps must be `uint64_t`
JavaScript `Date.now()` returns ~1.7e12 (Unix epoch ms), which **exceeds uint32**. ArduinoJson's `root["t"].is<uint32_t>()` returns false and your decoder silently drops the message. Use `uint64_t`:
```cpp
if (!root["t"].is<uint64_t>() && !root["t"].is<uint32_t>()) return BadShape;
out.t = root["t"].as<uint64_t>();
```

### HWCDC RX may need DTR/RTS asserted
On macOS, Node `serialport` doesn't auto-assert DTR. After opening, call:
```javascript
await new Promise((r, j) => port.set({ dtr: true, rts: true }, e => e ? j(e) : r()))
```

## Diagnostic Ladder

When something doesn't work, climb the ladder one rung at a time — don't skip:

1. **Screen text** — display HAL works? (Cheapest signal)
2. **Heartbeat in `loop()`** — `Serial.print(...)` works? Confirms TX path.
3. **`avail` field in heartbeat** — include `Serial.available()` in the heartbeat JSON so you can see whether host→device bytes are arriving at all.
4. **Raw byte dump on host** — `port.on('data', c => log(c.toString('hex')))` — bypasses your codec / framer.
5. **Full protocol round-trip** — only after 1–4 are confirmed.

## Coordination Patterns with Human Partner

| Pattern | Do | Don't |
|---|---|---|
| Asking for physical action | "Hold reset 3s, green LED blinks once, screen black, then tell me 'download mode'" | "Try to put it in download mode" |
| Recovering from failure | Each retry: ask for download mode → upload → ask for reset | Try to "soft-recover" with more `pio` flags |
| Trust signal | Wait for human's confirmation message before next step | Sleep and hope |
| Diagnostic prompts | "What does the screen show now?" | "Is it working?" |
| When stuck | Offer 2–3 concrete options (manual reflash via M5Burner / open case / defer hardware verification) | Loop on the same failing command |

## Common Mistakes

| Mistake | What goes wrong | Fix |
|---|---|---|
| Trying upload without download mode | "Could not configure port" — UiFlow2 holds USB | Always enter download mode first |
| Adding `--before=usb_reset` to esptool flags | Wedges USB further, port vanishes | Use default reset strategy; rely on manual download mode |
| Setting `ARDUINO_USB_MODE=0` because "TinyUSB CDC is more standard" | Port name changes to serial-number form; esptool can't re-flash | Use `USB_MODE=1` (HWCDC) for dev |
| Trusting default `Hard resetting via RTS pin...` | Board may stay in ROM/stub mode | After upload, run `--after watchdog_reset run`; then verify daemon reconnects |
| Using `Date.now()` timestamps without uint64 codec | Messages silently dropped — no error, no log | uint64 everywhere; or send `t:0` for testing |
| Sending host→device too fast after open | Bytes dropped because CDC not ready | Settle 500–1000 ms after `port.set({dtr:true,rts:true})` |
| Skipping diagnostic ladder | Hours of debugging the wrong layer | Climb ladder: screen → heartbeat → avail → raw hex → protocol |

## Quick Reference: First-Flash Sequence

```bash
# 1. Build only (do not let auto-upload-and-fail eat your download mode window)
pio run --project-dir firmware -e cores3-se

# 2. ASK HUMAN: "Hold reset 3 seconds. Green LED blinks, screen black. Tell me 'download mode'."

# 3. Verify and upload immediately
ls /dev/cu.usbmodem* && \
  pio run --project-dir firmware -e cores3-se -t upload --upload-port /dev/cu.usbmodem1101

# 4. Boot app without a manual RESET
esptool.py --port /dev/cu.usbmodem1101 --after watchdog_reset run

# 5. Verify firmware actually runs
ls /dev/cu.usbmodem*
# Then run your smoke test
```

## When to Stop and Switch Approaches

If after 3 download-mode attempts the upload still fails, suggest:

1. **M5Burner** (M5Stack's official tool) — knows the CoreS3-specific reset sequence and is most reliable for first flash
2. **Open the back cover, short G0 to GND** — guaranteed ROM entry, but requires disassembly
3. **Defer hardware verification** — software tests are deterministic; tag the milestone with "hardware verification deferred" and revisit later

Don't loop indefinitely on `pio upload`.
