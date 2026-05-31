# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versions track the **firmware** releases, tagged `fw-cores3-se-<version>` and
published as GitHub Releases. The `m5ct` CLI suite (`m5ct` / `m5ctd` /
`m5ct-statusline`) ships from the `packages/cli` package and currently tracks
the same line; its npm publish is pending.

## [Unreleased]

_Nothing yet._

## [0.5.0] — 2026-05-31

Tag: `fw-cores3-se-0.5.0`

### Added
- **BLE transport for CoreS3 SE** — the device can advertise over BLE, pair from
  `m5ct pair`, and reconnect as the default device without USB.
- **BLE device management** — paired devices can be listed, selected, and removed
  through the CLI.

### Changed
- Bumped the CLI suite (`m5ct`, `m5ctd`, `m5ct-statusline`) to `0.5.0`.
- Extended the BLE pairing window to five minutes.
- Long-press pairing entry now works from the waiting screen without requiring a
  top-right hot zone.

## [0.4.0] — 2026-05-30

Tag: `fw-cores3-se-0.4.0`

### Added
- **RTC time sync** — the daemon sends UTC + the host's local offset in the
  `hello` handshake; the device sets its RTC (stored as UTC) and the waiting
  screen shows correct local time.
- **Multi-session picker navigation** — picker session-model state and on-device
  navigation between the picker and per-session detail pages.

### Changed
- Removed the multi-session auto-pin contract from the protocol.
- Redesigned the status-screen header/footer.

## [0.3.1] — 2026-05-30

Tag: `fw-cores3-se-0.3.1`

### Fixed
- More reliable CoreS3 flash reset and corrected overview display.
- Multi-session identity: live entries are keyed by terminal slot, the picker is
  labelled by terminal, and pidless sessions expire quickly.

## [0.3.0] — 2026-05-25

Tag: `fw-cores3-se-0.3.0`

### Added
- First packaged release: a consolidated Claude Code status display rendering
  model, context usage, cost, rate limits, and git diff on a CoreS3 SE.
- `NoLink` / `Linked` / `Live` liveness state machine.
- Multi-session tracking with an on-device Sessions picker.
- Host-side screenshot (device streams raw RGB565; PNG is encoded on the host).
- `m5ct tap` command and an activity badge driven by Claude Code hook events.
- npm release packaging for the `m5ct` / `m5ctd` / `m5ct-statusline` bins.

[Unreleased]: https://github.com/houxiaomu/m5stack-coding-toys/compare/fw-cores3-se-0.5.0...HEAD
[0.5.0]: https://github.com/houxiaomu/m5stack-coding-toys/releases/tag/fw-cores3-se-0.5.0
[0.4.0]: https://github.com/houxiaomu/m5stack-coding-toys/releases/tag/fw-cores3-se-0.4.0
[0.3.1]: https://github.com/houxiaomu/m5stack-coding-toys/releases/tag/fw-cores3-se-0.3.1
[0.3.0]: https://github.com/houxiaomu/m5stack-coding-toys/releases/tag/fw-cores3-se-0.3.0
