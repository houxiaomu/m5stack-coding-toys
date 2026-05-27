# m5stack-coding-toys

M5Stack hardware controller for Claude Code CLI. Renders Claude Code session
state (model, context, cost, git, limits) on a physical M5Stack device. When
multiple Claude Code sessions are live, the device can auto-focus the session
that needs attention or let you pin a session from the Sessions page.

## Install (macOS)

```bash
npm i -g m5ct
m5ct install        # wire the hardware status line into ~/.claude/settings.json
                    # (backs up settings.json; chains any existing statusLine)
m5ct flash          # download + flash firmware to a connected M5Stack device
```

The background daemon (`m5ctd`) starts on demand and exits when idle.
`m5ct uninstall` restores your previous statusLine.

## CLI

```bash
m5ct --version
m5ct version
m5ct version --json
m5ctd --version
m5ct-statusline --version
m5ct status
```

`m5ct`, `m5ctd`, and `m5ct-statusline` are released together and report the same
runtime suite version from the published `m5ct` package.

> V1 is tested on macOS with the M5Stack CoreS3 SE. Other platforms/boards are best-effort.

## Layout

```
packages/
  protocol/         @m5stack-coding-toys/protocol         — wire format & schemas
  daemon/           @m5stack-coding-toys/daemon           — m5ctd long-running process
  statusline-shim/  @m5stack-coding-toys/statusline-shim  — m5ct-statusline, runs per Claude Code message
  cli/              m5ct                                  — published package; bundles the m5ct/m5ctd/m5ct-statusline bins
firmware/      PlatformIO project, envs: cores3-se, cardputer-adv, native
tools/
  fake-firmware/   TS device emulator for daemon integration tests
```

## Development

```bash
pnpm install                                       # one-time
pnpm test                                          # run all TS tests
pnpm build                                         # build all TS packages
pio run --project-dir firmware -e native           # build host-side firmware test target
pio run --project-dir firmware -e cores3-se        # build CoreS3 SE firmware
pio run --project-dir firmware -e cardputer-adv    # build Cardputer ADV firmware
```

## License

MIT — see [LICENSE](./LICENSE).
