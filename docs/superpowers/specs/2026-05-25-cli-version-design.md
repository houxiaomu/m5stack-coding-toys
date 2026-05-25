# CLI Version Design

## Context

The published `m5ct` package contains three cooperating executable entry points:

- `m5ct`
- `m5ctd`
- `m5ct-statusline`

These entry points are not independently released products. They are one runtime
suite installed from `packages/cli/package.json`, and the existing build already
stamps that package version into all bundled outputs through
`process.env.M5CT_VERSION`.

The daemon also uses its runtime version in the singleton pid lock. A live daemon
with the same version exits as already running; a live daemon with a different
version is treated as superseded so a newer install can take over.

## Decision

`packages/cli/package.json` is the single user-visible version source for the
runtime suite.

All three executable entry points report the same runtime suite version:

```text
m5ct 0.1.0
m5ctd 0.1.0
m5ct-statusline 0.1.0
```

Internal workspace package versions such as `@m5stack-coding-toys/daemon` and
`@m5stack-coding-toys/protocol` are not user-visible CLI versions unless those
packages become independently published products later.

## Command Surface

The main documented user interface is:

- `m5ct --version`
- `m5ct version`
- `m5ct version --json`

`m5ct --version` and `m5ct version` print the same human-readable label:

```text
m5ct 0.1.0
```

`m5ct version --json` prints a compact machine-readable object:

```json
{"name":"m5ct","version":"0.1.0"}
```

`-v` is intentionally not part of the version design. It remains available for a
future verbosity flag.

The support binaries also accept `--version`:

- `m5ctd --version`
- `m5ct-statusline --version`

These commands print their binary label and the same suite version, then exit.
They must not create sockets, pid files, logs, read stdin, connect to the daemon,
or start the daemon.

## Runtime Version API

Keep the existing daemon version module as the runtime suite version boundary,
but make the naming explicit. The shared API should expose the runtime identity
and label, for example:

```ts
runtimeInfo(): { name: 'm5ct'; version: string }
runtimeLabel(name?: string): string
```

The version value comes from `process.env.M5CT_VERSION`, which is injected by
`packages/cli/build.mjs` from `packages/cli/package.json`. Unbundled development
and test runs keep the existing fallback of `0.0.0`.

The daemon singleton lock continues to use the same runtime suite version value.

## Daemon Status

The daemon control `status` response gains an additive `runtime` field:

```ts
runtime: {
  name: 'm5ct'
  version: string
}
```

Human-readable `m5ct status` output shows the daemon's self-reported runtime
version before device state:

```text
daemon:      m5ct 0.1.0
state:       connected
board:       cores3-se
fw:          0.3.0
caps:        ...
device_id:   ...
```

`m5ct status --json` includes the same `runtime` object in the JSON payload.

For compatibility with older daemons that do not return `runtime`, the CLI must
not fail. It should display an unknown daemon runtime as `-`.

No explicit CLI-versus-daemon version comparison is required in `m5ct status`.
The daemon self-report is enough for troubleshooting, and the existing singleton
upgrade behavior is responsible for replacing older daemons.

## Implementation Boundaries

The change should stay small and use existing project structure:

- `packages/daemon/src/version.ts`: define the shared runtime suite version API.
- `packages/cli/src/main.ts`: handle `--version`, `version`, and
  `version --json` before normal subcommand dispatch.
- `packages/daemon/src/main.ts`: handle `--version` before daemon startup work.
- `packages/statusline-shim/src/main.ts`: handle `--version` before stdin reads
  and daemon bootstrap logic.
- `packages/daemon/src/control-ops.ts`: add `runtime` to status snapshots.
- `packages/cli/src/control-client.ts`: update the status response type while
  allowing missing `runtime` for old daemon compatibility.
- `packages/cli/src/cmd-status.ts`: display `daemon:` in human output and pass
  through JSON status unchanged.
- `README.md`: document the user-facing version commands briefly.

## Tests

Focused tests should cover:

- Runtime version helper fallback to `0.0.0`.
- Runtime version helper using an injected `M5CT_VERSION`.
- `m5ct --version` human output.
- `m5ct version` human output.
- `m5ct version --json` output.
- `listCommands()` includes `version`.
- Unknown command behavior still exits with code `2`.
- Daemon `status()` returns `runtime.version`.
- `m5ct status` human output includes `daemon:`.
- `m5ct status` remains compatible when daemon status lacks `runtime`.
- `m5ctd --version` exits before daemon startup side effects.
- `m5ct-statusline --version` exits before stdin and daemon bootstrap work.

## Non-Goals

- No per-binary independent versioning.
- No commit hash or build timestamp in this iteration.
- No release pipeline changes.
- No protocol or firmware version changes.
- No `-v` shorthand.
