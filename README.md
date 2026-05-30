# m5stack-coding-toys

English | [中文](README.zh-CN.md)

A physical status display for Claude Code. It mirrors your live Claude Code
session — model, context usage, cost, rate limits, git diff — onto an M5Stack
device on your desk, so you can glance at where a run stands without switching
windows. When several sessions are running at once, the device becomes a picker
you tap through.

<img src="docs/m5stack-coding-toys-cores3.jpg" alt="m5stack-coding-toys running on a CoreS3 SE" width="305">


## What it shows

The device renders a small set of pages; tap to cycle through them.

- **Overview** — the model in use and an activity badge (working / your turn /
  needs attention), plus compact tiles: **CONTEXT** (used % and token count),
  **5H BLOCK** (rate-limit usage and time until reset), **SESSION** (cost so far
  and burn rate), and **DIFF** (git lines added/removed, staged/modified counts).
- **Workspace / Cost / Limits** — fuller detail pages for the same data.
- **Sessions** — when more than one Claude Code session is live, the device owns
  selection: a picker lists every session and flags the ones that need you.
  Tapping one opens its detail pages without interrupting the others; tapping a
  detail-page header jumps back to the picker.
- **Waiting** — shown when no session is active: a clock and date (synced to your
  host's local time over the link), connection state, and battery.

## Where to buy

The hardware is made by M5Stack and sold at the official shop:
**[shop.m5stack.com](https://shop.m5stack.com/)**.

This project currently supports the **M5Stack CoreS3 series** (CoreS3 and
CoreS3 SE). V1 is verified on macOS with the **CoreS3 SE**. The Cardputer ADV
firmware target builds but is not yet hardware-verified; other platforms and
boards are best-effort.

## Install (macOS)

```bash
npm i -g m5ct
m5ct install        # wire the status display into ~/.claude/settings.json
                    # (backs up settings.json; chains any existing statusLine)
m5ct flash          # download + flash firmware to a connected M5Stack device
```

The background daemon (`m5ctd`) starts on demand and exits when idle. It is a
singleton and coordinates the serial port, so `m5ct flash` can take it over and
hand it back automatically. `m5ct uninstall` restores your previous statusLine.

When flashing a CoreS3 SE for the first time, see the bring-up notes in
[`docs/architecture/firmware-hardware-gotchas.md`](docs/architecture/firmware-hardware-gotchas.md) —
auto-reset is unreliable, the pre-loaded UiFlow2 firmware blocks the first
flash, and USB mode matters.

## How it works

```
Claude Code  ──statusLine──▶  m5ct-statusline  ──▶  m5ctd  ──NDJSON/serial──▶  M5Stack
 (per message)                  (shim)          (aggregate + git enrich)        (render)
```

Claude Code's `statusLine` invokes the `m5ct-statusline` shim on every message.
The shim forwards the raw JSON to the `m5ctd` daemon, which aggregates it,
enriches it (git status, burn history), resolves the owning Claude Code process,
and pushes a single consolidated `status` frame to the device over a small
NDJSON-over-serial protocol. The device is a thin renderer driven by a
three-state liveness machine — **NoLink / Linked / Live** — so it stays on the
status page while a session is idle-but-alive and only falls back to Waiting
when the session actually ends.

Deeper notes (data flow, the liveness machine, the protocol, RGB565
screenshots, firmware gotchas) live in
[`docs/architecture/`](docs/architecture/README.md); contributor and agent
guidance is in [`AGENTS.md`](AGENTS.md).

## License

MIT — see [LICENSE](./LICENSE).
