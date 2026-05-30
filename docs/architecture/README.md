# Architecture & engineering notes

Durable knowledge about m5stack-coding-toys, distilled from development sessions — meant for any coding agent or contributor working on the repo. Project overview, status, and known gaps live in the root [`AGENTS.md`](../../AGENTS.md).

| Doc | What it covers |
|-----|----------------|
| [status-display.md](status-display.md) | statusLine → daemon → device data flow; the 3-state liveness machine (NoLink / Linked / Live) |
| [adding-a-host-device-rpc.md](adding-a-host-device-rpc.md) | The 7-layer checklist for a new RPC / `m5ct` command (copy `tap`/`screenshot`; don't forget `pnpm gen:msgs`) |
| [screenshot-rgb565.md](screenshot-rgb565.md) | Why screenshots stream raw RGB565 and encode PNG host-side (on-device PNG is impossible on ESP32-S3) |
| [daemon-singleton-and-install.md](daemon-singleton-and-install.md) | Daemon lockfile singleton, npm-only distribution, global symlink, `m5ct install` settings.json chaining |
| [ble-transport.md](ble-transport.md) | BLE transport boundaries, current host/firmware slice, screenshot limitation, hardware follow-up |
| [firmware-hardware-gotchas.md](firmware-hardware-gotchas.md) | ESP32-S3 gotchas: RX buffer truncation, USB-CDC baud, reset paths, orphan daemons |
| [driving-a-worktree-build-on-device.md](driving-a-worktree-build-on-device.md) | How to flash & drive a worktree firmware+daemon build on real CoreS3 |

> These are point-in-time notes; file/line references may drift. Verify against current code before relying on a specific detail.
