# Contributing

Thanks for your interest in m5stack-coding-toys. This is a pnpm + PlatformIO
monorepo: four TypeScript packages (`protocol`, `daemon`, `statusline-shim`,
`cli`) plus a `firmware/` PlatformIO project and host-side `tools/`.

## Prerequisites

- **Node** — version pinned in [`.nvmrc`](.nvmrc) (`nvm use`); minimum is in the
  `m5ct` package `engines`.
- **pnpm** — the workspace package manager.
- **PlatformIO** (`pio`) — for firmware builds and the host-side `native` test
  target. The ESP32 toolchain is only needed to build device firmware.

## Setup

```bash
pnpm install                              # install all workspace deps
pnpm build                                # build all TS packages
pnpm test                                 # run all TS tests (vitest)
pio run --project-dir firmware -e native  # build host-side firmware tests
pio test --project-dir firmware -e native # run firmware unit tests (Unity)
```

## Checks to run before opening a PR

CI runs these (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)); run
them locally first:

```bash
pnpm lint            # Biome lint
pnpm build           # tsc build
pnpm typecheck       # tsc --noEmit
pnpm test            # vitest
pnpm gen:msgs:check  # verify generated firmware/lib/m5proto/messages.h is in sync
pio test --project-dir firmware -e native
```

If you touched the protocol, run `pnpm gen:msgs` to regenerate the C++ header
and commit it. Format with `pnpm biome check --write .`.

## Commit & PR conventions

- **Conventional Commits** — `feat:`, `fix:`, `docs:`, `test:`, `chore:`,
  `style:`, `refactor:`, with an optional scope (`feat(daemon): …`,
  `fix(firmware): …`).
- Code, comments, and commit messages are in **English**; design docs may be in
  中文.
- Keep PRs focused. Branch off `main`; don't commit directly to `main`.
- Include tests for behaviour changes. Follow the existing test style in the
  package you're editing (vitest for TS, Unity for firmware `native`).

## Architecture & where things live

- Durable engineering notes: [`docs/architecture/`](docs/architecture/README.md)
  — data flow, the liveness machine, adding a host→device RPC, firmware gotchas.
- Project overview, status, and known gaps: [`AGENTS.md`](AGENTS.md).
- Adding a new `m5ct` host→device command touches ~7 layers — follow
  [`docs/architecture/adding-a-host-device-rpc.md`](docs/architecture/adding-a-host-device-rpc.md)
  and copy the `tap` / `screenshot` commands.

## Hardware

V1 is verified on the **CoreS3 SE**. First-flash is finicky (auto-reset is
unreliable, UiFlow2 blocks the first flash, USB mode matters) — see
[`docs/architecture/firmware-hardware-gotchas.md`](docs/architecture/firmware-hardware-gotchas.md).
Note in your PR whether a change was hardware-verified and on which board.

## Releasing firmware

Firmware releases are tagged `fw-cores3-se-<version>` with the three-file set
(`bootloader.bin` / `partitions.bin` / `firmware.bin`) attached to a GitHub
Release: bump `fw_ver` in `firmware/boards/cores3_se/board.cpp`, rebuild, run
`firmware/scripts/build-manifest.sh` and `scripts/gen-firmware-index.mjs`, update
`packages/cli/src/firmware-index.ts`, then tag and upload. Record the change in
[`CHANGELOG.md`](CHANGELOG.md).

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
