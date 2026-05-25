# CLI Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coherent runtime suite version model for `m5ct`, `m5ctd`, and `m5ct-statusline`.

**Architecture:** `packages/cli/package.json` remains the only published suite version source, and `packages/cli/build.mjs` continues injecting it as `process.env.M5CT_VERSION` into all bundles. Each entry point reads that same injected value at runtime, while daemon status exposes the daemon's self-reported runtime version over the existing control socket. Command dispatch gets small dependency-injection seams so version behavior can be tested without real `process.exit`, sockets, or stdin.

**Tech Stack:** TypeScript ESM, pnpm workspaces, Vitest, esbuild bundle-time `define`.

---

## File Structure

- `packages/daemon/src/version.ts`: owns daemon-side runtime version helpers and keeps `version()` as a compatibility alias for singleton lock code.
- `packages/daemon/src/version.test.ts`: tests injected and fallback runtime version behavior.
- `packages/cli/src/runtime-version.ts`: CLI-side helper that reads the same injected `M5CT_VERSION` value without importing daemon source across package boundaries.
- `packages/cli/src/main.ts`: exposes a testable `runCli()` dispatcher and handles `--version`, `version`, and `version --json`.
- `packages/cli/src/main.test.ts`: covers CLI version commands, `listCommands()`, and unknown command handling.
- `packages/daemon/src/control-ops.ts`: adds `runtime` to status snapshots.
- `packages/daemon/src/control-ops.test.ts`: asserts daemon status includes runtime info.
- `packages/cli/src/control-client.ts`: makes daemon `runtime` optional for old-daemon compatibility.
- `packages/cli/src/cmd-status.ts`: displays daemon runtime in human output and keeps JSON passthrough.
- `packages/cli/src/cmd-status.test.ts`: covers human output with runtime and without runtime.
- `packages/daemon/src/main.ts`: handles `--version` before daemon startup side effects.
- `packages/daemon/src/main-version.test.ts`: covers the daemon version flag helper.
- `packages/statusline-shim/src/runtime-version.ts`: statusline-side helper that reads the same injected `M5CT_VERSION` value.
- `packages/statusline-shim/src/main.ts`: handles `--version` before stdin, socket, or daemon bootstrap work.
- `packages/statusline-shim/src/main.test.ts`: covers statusline version formatting and early version behavior.
- `README.md`: documents the user-facing version commands.

The CLI and statusline helpers duplicate only the tiny read/format wrapper. The single version source is still the build-injected `M5CT_VERSION`, which is stamped from `packages/cli/package.json` into all three bundles. This avoids fragile TypeScript imports from one package's `src/` directory into another.

---

### Task 1: Daemon Runtime Version Helpers

**Files:**
- Modify: `packages/daemon/src/version.ts`
- Modify: `packages/daemon/src/index.ts`
- Create: `packages/daemon/src/version.test.ts`

- [ ] **Step 1: Write the failing daemon version tests**

Create `packages/daemon/src/version.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RUNTIME_NAME, runtimeInfo, runtimeLabel, runtimeVersion, version } from './version.js'

describe('runtime version helpers', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    delete process.env.M5CT_VERSION
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.M5CT_VERSION
    else process.env.M5CT_VERSION = previous
  })

  it('falls back to 0.0.0 when no bundle version is injected', () => {
    expect(RUNTIME_NAME).toBe('m5ct')
    expect(runtimeVersion()).toBe('0.0.0')
    expect(version()).toBe('0.0.0')
    expect(runtimeInfo()).toEqual({ name: 'm5ct', version: '0.0.0' })
    expect(runtimeLabel()).toBe('m5ct 0.0.0')
  })

  it('uses the injected suite version when present', () => {
    process.env.M5CT_VERSION = '9.8.7'
    expect(runtimeVersion()).toBe('9.8.7')
    expect(version()).toBe('9.8.7')
    expect(runtimeInfo()).toEqual({ name: 'm5ct', version: '9.8.7' })
    expect(runtimeLabel('m5ctd')).toBe('m5ctd 9.8.7')
  })
})
```

- [ ] **Step 2: Run the failing daemon version tests**

Run: `pnpm vitest run packages/daemon/src/version.test.ts`

Expected: FAIL because `RUNTIME_NAME`, `runtimeInfo`, `runtimeLabel`, and `runtimeVersion` are not exported yet.

- [ ] **Step 3: Implement the daemon runtime version helpers**

Replace `packages/daemon/src/version.ts` with:

```ts
export const RUNTIME_NAME = 'm5ct'

export interface RuntimeInfo {
  name: typeof RUNTIME_NAME
  version: string
}

export function runtimeVersion(): string {
  // Injected at bundle time by the m5ct build (esbuild `define`). Falls back to
  // '0.0.0' for unbundled dev runs (tsc output / tests).
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeInfo(): RuntimeInfo {
  return { name: RUNTIME_NAME, version: runtimeVersion() }
}

export function runtimeLabel(name: string = RUNTIME_NAME): string {
  return `${name} ${runtimeVersion()}`
}

export function version(): string {
  return runtimeVersion()
}
```

Update `packages/daemon/src/index.ts` first line to:

```ts
export { RUNTIME_NAME, runtimeInfo, runtimeLabel, runtimeVersion, version } from './version.js'
```

- [ ] **Step 4: Run the daemon version tests**

Run: `pnpm vitest run packages/daemon/src/version.test.ts packages/daemon/src/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/daemon/src/version.ts packages/daemon/src/version.test.ts packages/daemon/src/index.ts
git commit -m "feat: add runtime version helpers"
```

---

### Task 2: Main CLI Version Command

**Files:**
- Create: `packages/cli/src/runtime-version.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/src/main.test.ts`

- [ ] **Step 1: Write failing CLI version tests**

Replace `packages/cli/src/main.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listCommands, runCli } from './main.js'

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      log: (line: string) => stdout.push(line),
      error: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  }
}

describe('@m5stack-coding-toys/cli', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '1.2.3'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.M5CT_VERSION
    else process.env.M5CT_VERSION = previous
  })

  it('declares only the implemented subcommands', () => {
    expect(listCommands()).toEqual(['status', 'watch', 'flash', 'install', 'uninstall', 'version'])
  })

  it('prints --version without running a subcommand', async () => {
    const c = capture()
    await expect(runCli(['--version'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['m5ct 1.2.3'])
    expect(c.stderr).toEqual([])
  })

  it('prints version as a subcommand', async () => {
    const c = capture()
    await expect(runCli(['version'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['m5ct 1.2.3'])
    expect(c.stderr).toEqual([])
  })

  it('prints version as compact json', async () => {
    const c = capture()
    await expect(runCli(['version', '--json'], c.io)).resolves.toBe(0)
    expect(c.stdout).toEqual(['{"name":"m5ct","version":"1.2.3"}'])
    expect(c.stderr).toEqual([])
  })

  it('keeps unknown commands as usage errors', async () => {
    const c = capture()
    await expect(runCli(['nope'], c.io)).resolves.toBe(2)
    expect(c.stdout).toEqual([])
    expect(c.stderr).toEqual(['unknown command: nope'])
  })
})
```

- [ ] **Step 2: Run the failing CLI tests**

Run: `pnpm vitest run packages/cli/src/main.test.ts`

Expected: FAIL because `runCli` and the `version` command do not exist.

- [ ] **Step 3: Add the CLI runtime version helper**

Create `packages/cli/src/runtime-version.ts`:

```ts
export const RUNTIME_NAME = 'm5ct'

export interface RuntimeInfo {
  name: typeof RUNTIME_NAME
  version: string
}

export function runtimeVersion(): string {
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeInfo(): RuntimeInfo {
  return { name: RUNTIME_NAME, version: runtimeVersion() }
}

export function runtimeLabel(name: string = RUNTIME_NAME): string {
  return `${name} ${runtimeVersion()}`
}
```

- [ ] **Step 4: Refactor CLI dispatch and implement version handling**

In `packages/cli/src/main.ts`, import the helper:

```ts
import { runtimeInfo, runtimeLabel } from './runtime-version.js'
```

Change `listCommands()` to include `version`:

```ts
export function listCommands(): readonly string[] {
  return ['status', 'watch', 'flash', 'install', 'uninstall', 'version'] as const
}
```

Add a small injectable IO interface near the top of the file:

```ts
export interface CliIO {
  log(line: string): void
  error(line: string): void
}

const defaultIO: CliIO = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}
```

Replace `function main(): void` with a testable dispatcher:

```ts
export async function runCli(args: readonly string[], io: CliIO = defaultIO): Promise<number> {
  const sub = args[0]
  const rest = args.slice(1)

  if (sub === '--version') {
    io.log(runtimeLabel())
    return 0
  }

  if (!sub) {
    io.log(`usage: m5ct <${listCommands().join('|')}>`)
    return 2
  }

  if (!listCommands().includes(sub)) {
    io.error(`unknown command: ${sub}`)
    return 2
  }

  switch (sub) {
    case 'version':
      if (rest.includes('--json')) io.log(JSON.stringify(runtimeInfo()))
      else io.log(runtimeLabel())
      return 0
    case 'install':
      return runInstall(rest)
    case 'uninstall':
      return runUninstall(rest)
    case 'status':
      return runStatus({ json: rest.includes('--json') })
    case 'watch':
      return runWatch()
    case 'flash':
      return runFlash(rest)
    default:
      io.error(`unknown command: ${sub}`)
      return 2
  }
}

function main(): void {
  runCli(process.argv.slice(2)).then((code) => process.exit(code))
}
```

Leave the existing `isEntryPoint()` guard and `if (isEntryPoint()) { main() }` block in place.

- [ ] **Step 5: Run the CLI tests**

Run: `pnpm vitest run packages/cli/src/main.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/cli/src/runtime-version.ts packages/cli/src/main.ts packages/cli/src/main.test.ts
git commit -m "feat: add m5ct version command"
```

---

### Task 3: Daemon Status Runtime Field

**Files:**
- Modify: `packages/daemon/src/control-ops.ts`
- Modify: `packages/daemon/src/control-ops.test.ts`
- Modify: `packages/cli/src/control-client.ts`
- Modify: `packages/cli/src/cmd-status.ts`
- Create: `packages/cli/src/cmd-status.test.ts`

- [ ] **Step 1: Write the failing daemon status test**

In `packages/daemon/src/control-ops.test.ts`, update the `status returns snapshot` test body:

```ts
  it('status returns snapshot with runtime info', async () => {
    const out = await rpc(sock, { op: 'status' })
    const r = JSON.parse(out) as {
      runtime: { name: string; version: string }
      state: string
      board: string
    }
    expect(r.runtime).toEqual({ name: 'm5ct', version: '0.0.0' })
    expect(r.state).toBe('Connected')
    expect(r.board).toBe('X')
  })
```

- [ ] **Step 2: Run the failing daemon status test**

Run: `pnpm vitest run packages/daemon/src/control-ops.test.ts`

Expected: FAIL because `runtime` is missing.

- [ ] **Step 3: Add runtime to daemon status snapshots**

In `packages/daemon/src/control-ops.ts`, import `runtimeInfo`:

```ts
import { runtimeInfo, type RuntimeInfo } from './version.js'
```

Update `StatusSnapshot`:

```ts
export interface StatusSnapshot {
  runtime: RuntimeInfo
  state: ManagerState
  board: string | null
  fw: string | null
  caps: readonly string[]
  device_id: string | null
}
```

Add `runtime` in `status()`:

```ts
      return {
        runtime: runtimeInfo(),
        state: dm.state(),
        board: sess?.info?.board ?? null,
        fw: sess?.info?.fw ?? null,
        caps: sess?.info?.caps ?? [],
        device_id: sess?.info?.device_id ?? null,
      }
```

- [ ] **Step 4: Run daemon status tests**

Run: `pnpm vitest run packages/daemon/src/control-ops.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing CLI status output tests**

Create `packages/cli/src/cmd-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { type DaemonStatus } from './control-client.js'
import { formatStatusLines, runStatus } from './cmd-status.js'

const baseStatus: DaemonStatus = {
  runtime: { name: 'm5ct', version: '1.2.3' },
  state: 'Connected',
  board: 'cores3-se',
  fw: '0.3.0',
  caps: ['display'],
  device_id: 'dev-1',
}

describe('formatStatusLines', () => {
  it('includes daemon runtime before device state', () => {
    expect(formatStatusLines(baseStatus)).toEqual([
      'daemon:      m5ct 1.2.3',
      'state:       Connected',
      'board:       cores3-se',
      'fw:          0.3.0',
      'caps:        display',
      'device_id:   dev-1',
    ])
  })

  it('is compatible with old daemon status without runtime', () => {
    const oldStatus = { ...baseStatus, runtime: undefined }
    expect(formatStatusLines(oldStatus).at(0)).toBe('daemon:      -')
  })
})

describe('runStatus', () => {
  it('prints human status lines', async () => {
    const out: string[] = []
    const code = await runStatus({
      call: async () => baseStatus,
      log: (line) => out.push(line),
    })
    expect(code).toBe(0)
    expect(out[0]).toBe('daemon:      m5ct 1.2.3')
  })

  it('passes json status through unchanged', async () => {
    const out: string[] = []
    const code = await runStatus({
      json: true,
      call: async () => baseStatus,
      log: (line) => out.push(line),
    })
    expect(code).toBe(0)
    expect(JSON.parse(out[0] ?? '{}')).toEqual(baseStatus)
  })
})
```

- [ ] **Step 6: Run the failing CLI status tests**

Run: `pnpm vitest run packages/cli/src/cmd-status.test.ts`

Expected: FAIL because `formatStatusLines` and injectable `runStatus` options do not exist.

- [ ] **Step 7: Update control-client and status command**

In `packages/cli/src/control-client.ts`, update `DaemonStatus`:

```ts
export interface DaemonStatus {
  runtime?: {
    name: string
    version: string
  }
  state: string
  board: string | null
  fw: string | null
  caps: readonly string[]
  device_id: string | null
}
```

Replace `packages/cli/src/cmd-status.ts` with:

```ts
import { type DaemonStatus, callOnce, defaultSocket } from './control-client.js'

type StatusCall = (sockPath: string, msg: object) => Promise<DaemonStatus>

export interface StatusRunOpts {
  json?: boolean
  socket?: string
  call?: StatusCall
  log?: (line: string) => void
  error?: (line: string) => void
}

export function formatStatusLines(r: DaemonStatus): string[] {
  const daemon = r.runtime ? `${r.runtime.name} ${r.runtime.version}` : '-'
  return [
    `daemon:      ${daemon}`,
    `state:       ${r.state}`,
    `board:       ${r.board ?? '-'}`,
    `fw:          ${r.fw ?? '-'}`,
    `caps:        ${r.caps.join(', ') || '-'}`,
    `device_id:   ${r.device_id ?? '-'}`,
  ]
}

export async function runStatus(opts: StatusRunOpts = {}): Promise<number> {
  const log = opts.log ?? console.log
  const error = opts.error ?? console.error
  const call: StatusCall = opts.call ?? ((sockPath, msg) => callOnce<DaemonStatus>(sockPath, msg))
  try {
    const r = await call(opts.socket ?? defaultSocket(), { op: 'status' })
    if (opts.json) {
      log(JSON.stringify(r, null, 2))
      return 0
    }
    for (const line of formatStatusLines(r)) log(line)
    return 0
  } catch (err) {
    error(`m5ct status: ${(err as Error).message}`)
    return 1
  }
}
```

- [ ] **Step 8: Run status-related tests**

Run: `pnpm vitest run packages/daemon/src/control-ops.test.ts packages/cli/src/cmd-status.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add packages/daemon/src/control-ops.ts packages/daemon/src/control-ops.test.ts packages/cli/src/control-client.ts packages/cli/src/cmd-status.ts packages/cli/src/cmd-status.test.ts
git commit -m "feat: expose daemon runtime in status"
```

---

### Task 4: Daemon Binary `--version`

**Files:**
- Create: `packages/daemon/src/main-version.test.ts`
- Modify: `packages/daemon/src/main.ts`

- [ ] **Step 1: Write failing daemon entry version helper tests**

Create `packages/daemon/src/main-version.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { printVersionIfRequested } from './main.js'

describe('m5ctd --version entry behavior', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '2.3.4'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.M5CT_VERSION
    else process.env.M5CT_VERSION = previous
  })

  it('prints daemon binary label and reports that startup should stop', () => {
    const out: string[] = []
    expect(printVersionIfRequested(['--version'], (line) => out.push(line))).toBe(true)
    expect(out).toEqual(['m5ctd 2.3.4'])
  })

  it('ignores normal daemon startup args', () => {
    const out: string[] = []
    expect(printVersionIfRequested([], (line) => out.push(line))).toBe(false)
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run the failing daemon entry tests**

Run: `pnpm vitest run packages/daemon/src/main-version.test.ts`

Expected: FAIL because importing `main.js` currently starts the daemon and `printVersionIfRequested` does not exist.

- [ ] **Step 3: Add entrypoint guard and daemon version flag**

In `packages/daemon/src/main.ts`, extend the imports:

```ts
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runtimeLabel, version } from './version.js'
```

If `mkdirSync` is currently imported from `node:fs`, combine it with `realpathSync`:

```ts
import { mkdirSync, realpathSync } from 'node:fs'
```

Add the helper before `async function main()`:

```ts
export function printVersionIfRequested(
  args: readonly string[],
  writeLine: (line: string) => void = (line) => console.log(line),
): boolean {
  if (!args.includes('--version')) return false
  writeLine(runtimeLabel('m5ctd'))
  return true
}
```

Add an entrypoint guard near the bottom:

```ts
function isEntryPoint(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
```

Replace the unconditional bottom-level call:

```ts
main().catch((err) => {
  log.error('fatal', { error: (err as Error).message, stack: (err as Error).stack })
  process.exit(1)
})
```

with:

```ts
if (isEntryPoint()) {
  if (printVersionIfRequested(process.argv.slice(2))) {
    process.exit(0)
  }
  main().catch((err) => {
    log.error('fatal', { error: (err as Error).message, stack: (err as Error).stack })
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run daemon entry tests**

Run: `pnpm vitest run packages/daemon/src/main-version.test.ts packages/daemon/src/main.test.ts`

Expected: PASS. If `packages/daemon/src/main.test.ts` does not exist, run only `packages/daemon/src/main-version.test.ts`.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/daemon/src/main.ts packages/daemon/src/main-version.test.ts
git commit -m "feat: add m5ctd version flag"
```

---

### Task 5: Statusline Binary `--version`

**Files:**
- Create: `packages/statusline-shim/src/runtime-version.ts`
- Modify: `packages/statusline-shim/src/main.ts`
- Modify: `packages/statusline-shim/src/main.test.ts`

- [ ] **Step 1: Write failing statusline version tests**

Append these tests to `packages/statusline-shim/src/main.test.ts`:

```ts
describe('m5ct-statusline --version entry behavior', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.M5CT_VERSION
    process.env.M5CT_VERSION = '3.4.5'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.M5CT_VERSION
    else process.env.M5CT_VERSION = previous
  })

  it('prints statusline binary label and reports that startup should stop', () => {
    const out: string[] = []
    expect(printVersionIfRequested(['--version'], (line) => out.push(line))).toBe(true)
    expect(out).toEqual(['m5ct-statusline 3.4.5'])
  })

  it('ignores normal statusline invocations', () => {
    const out: string[] = []
    expect(printVersionIfRequested([], (line) => out.push(line))).toBe(false)
    expect(out).toEqual([])
  })
})
```

Update the import at the top of `packages/statusline-shim/src/main.test.ts` to include `printVersionIfRequested`:

```ts
import { buildDaemonPayload, buildSummary, chainedStatusLine, printVersionIfRequested } from './main.js'
```

Update the Vitest import to include `afterEach` and `beforeEach`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
```

- [ ] **Step 2: Run the failing statusline tests**

Run: `pnpm vitest run packages/statusline-shim/src/main.test.ts`

Expected: FAIL because `printVersionIfRequested` does not exist.

- [ ] **Step 3: Add statusline runtime helper**

Create `packages/statusline-shim/src/runtime-version.ts`:

```ts
export function runtimeVersion(): string {
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeLabel(name: string): string {
  return `${name} ${runtimeVersion()}`
}
```

- [ ] **Step 4: Handle version before stdin and daemon work**

In `packages/statusline-shim/src/main.ts`, import the helper:

```ts
import { runtimeLabel } from './runtime-version.js'
```

Add this exported helper before `async function main()`:

```ts
export function printVersionIfRequested(
  args: readonly string[],
  writeLine: (line: string) => void = (line) => console.log(line),
): boolean {
  if (!args.includes('--version')) return false
  writeLine(runtimeLabel('m5ct-statusline'))
  return true
}
```

Change the entrypoint block at the bottom from:

```ts
if (isEntryPoint()) void main()
```

to:

```ts
if (isEntryPoint()) {
  if (printVersionIfRequested(process.argv.slice(2))) {
    process.exit(0)
  }
  void main()
}
```

- [ ] **Step 5: Run statusline tests**

Run: `pnpm vitest run packages/statusline-shim/src/main.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add packages/statusline-shim/src/runtime-version.ts packages/statusline-shim/src/main.ts packages/statusline-shim/src/main.test.ts
git commit -m "feat: add statusline version flag"
```

---

### Task 6: Documentation And End-to-End Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README with version commands**

In `README.md`, add a short CLI section after the install paragraph and before the V1 platform note:

````md
## CLI

```bash
m5ct --version
m5ct version
m5ct version --json
m5ct status
```

`m5ct`, `m5ctd`, and `m5ct-statusline` are released together and report the same
runtime suite version from the published `m5ct` package.
````

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm vitest run \
  packages/daemon/src/version.test.ts \
  packages/cli/src/main.test.ts \
  packages/daemon/src/control-ops.test.ts \
  packages/cli/src/cmd-status.test.ts \
  packages/daemon/src/main-version.test.ts \
  packages/statusline-shim/src/main.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
pnpm --filter @m5stack-coding-toys/daemon typecheck
pnpm --filter m5ct typecheck
pnpm --filter @m5stack-coding-toys/statusline-shim typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 4: Build the published CLI bundle**

Run:

```bash
pnpm --filter m5ct build
```

Expected: build exits `0` and prints `built m5ct, m5ctd, m5ct-statusline`.

- [ ] **Step 5: Verify bundled version commands**

Run:

```bash
node packages/cli/dist/m5ct.js --version
node packages/cli/dist/m5ct.js version --json
node packages/cli/dist/m5ctd.js --version
node packages/cli/dist/m5ct-statusline.js --version
```

Expected output, using the current `packages/cli/package.json` version:

```text
m5ct 0.1.0
{"name":"m5ct","version":"0.1.0"}
m5ctd 0.1.0
m5ct-statusline 0.1.0
```

- [ ] **Step 6: Run the full TypeScript test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add README.md
git commit -m "docs: document cli version commands"
```

---

## Self-Review

- Spec coverage: The plan covers one suite version for all three binaries, user-facing `m5ct --version` / `m5ct version` / `m5ct version --json`, support-binary `--version`, daemon status runtime reporting, old-daemon compatibility, docs, and focused tests.
- Marker scan: No task uses unresolved markers or unspecified "add tests" language. Each test and implementation step includes concrete code.
- Type consistency: `runtimeInfo()` consistently returns `{ name: 'm5ct'; version: string }`. CLI status treats `runtime` as optional for compatibility. `runtimeLabel(name?: string)` on daemon and CLI side matches the spec's label behavior.
