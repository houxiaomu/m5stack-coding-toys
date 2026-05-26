# m5stack-coding-toys — agent guide

A physical hardware status display for Claude Code (consolidated status, like ccstatusline on a screen). A self-developed protocol over NDJSON connects Claude Code ↔ M5Stack hardware. One data protocol; devices differ only in display UI. V1 targets **CoreS3 SE** + **Cardputer ADV** with a HAL abstraction.

## Conventions

- Conventional commits. **Code, comments, and commit messages in English; design docs in 中文.**
- Tooling: Biome (lint/format) + Vitest (TS) + Unity (firmware native tests). pnpm workspace.
- Each feature follows: design → plan → vertical-slice implementation → tests → biome format → merge.
- Design specs & plans live in `docs/superpowers/{specs,plans}/`.

## Layout

- **4 TS packages** — `@m5stack-coding-toys/{protocol,daemon,cli,statusline-shim}` (the old `hook-shim` was removed).
- **`firmware/`** — PlatformIO, multiple envs (C++ / M5GFX / M5Unified).
- **`tools/{gen-msgs,fake-firmware}`** — protocol→C++ header codegen, and a host-side device emulator for hardware-free e2e tests.
- **Bins:** `m5ctd` (daemon), `m5ct` (CLI), `m5ct-statusline` (shim). Runtime dir `~/.m5stack-coding-toys/`.

## Architecture & engineering notes

Durable knowledge lives in [`docs/architecture/`](docs/architecture/README.md):

- [Status display & liveness](docs/architecture/status-display.md) — the data flow and the NoLink/Linked/Live state machine
- [Adding a host→device RPC](docs/architecture/adding-a-host-device-rpc.md) — the 7-layer checklist for a new `m5ct` command
- [Screenshot (RGB565)](docs/architecture/screenshot-rgb565.md)
- [Daemon singleton & install](docs/architecture/daemon-singleton-and-install.md)
- [Firmware hardware gotchas](docs/architecture/firmware-hardware-gotchas.md)
- [Driving a worktree build on device](docs/architecture/driving-a-worktree-build-on-device.md)

When flashing CoreS3 SE, use the `m5stack-cores3-bring-up` skill in `.claude/skills/` — auto-reset doesn't work, UiFlow2 blocks the first flash, and USB_MODE matters.

## Status (as of 2026-05-27 — verify against git before relying on it)

The status-display reposition, liveness redesign, release packaging, host-screenshot, tap command, and activity-badge work are all merged to `main` and HW-verified on CoreS3 SE; `main` is in sync with `origin`. CLI version 0.1.0; firmware release tag `fw-cores3-se-0.3.0` exists. Milestones M0–M5 are V1 (M6/M7 = V1.x: BLE/WS transport, tmux prompt injection).

### Known gaps toward V1 done

- **Cardputer ADV is NOT hardware-verified** — no cardputer-adv firmware manifest; device-manager and M3/M5 acceptance only exercised on CoreS3.
- **npm publish not done** — verify the `m5ct` name is free (`npm view m5ct`, fallback `@m5stack-coding-toys/m5ct`), set repo secret `NPM_TOKEN`, upload the firmware three-file set to the `fw-cores3-se-0.3.0` GitHub Release, then `git tag v0.1.0 && git push --tags` triggers `.github/workflows/release.yml`.
- **`m5ct install` real auto-start** — launchd-plist generation still deferred (install writes settings.json but not a launch agent).
- **Reconnect robustness** — on supersede/open-failure the `DevicePoller.seen` set is never cleared, so a device that fails to open isn't re-attempted until replug; a daemon was also once observed stuck in Scanning after a failed hello. Both are pre-existing device-manager gaps left for a hardware-in-hand session.
