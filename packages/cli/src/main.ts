#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runFlash } from './cmd-flash.js'
import { runScreenshot } from './cmd-screenshot.js'
import { runStatus } from './cmd-status.js'
import { runTap } from './cmd-tap.js'
import { runWatch } from './cmd-watch.js'
import { computeInstallPatch, computeUninstall, writeSettings } from './install.js'
import { readM5ctConfig, writeM5ctConfig } from './m5ct-config.js'
import { runtimeInfo, runtimeLabel } from './runtime-version.js'

export function listCommands(): readonly string[] {
  return ['status', 'watch', 'flash', 'install', 'uninstall', 'version', 'screenshot', 'tap'] as const
}

export interface CliIO {
  log(line: string): void
  error(line: string): void
}

const defaultIO: CliIO = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}

function runInstall(args: readonly string[]): number {
  const dryRun = args.includes('--dry-run')
  const patch = computeInstallPatch()
  if (patch.added.length === 0) {
    console.log('m5ct statusLine already installed in ~/.claude/settings.json')
    return 0
  }
  console.log(`Will set statusLine in ${patch.path}:`)
  for (const a of patch.added) console.log(`  ${a.field.padEnd(14)} → ${a.command}`)
  if (patch.chainedCommand) {
    console.log(`  (will chain your existing statusLine: ${patch.chainedCommand})`)
  }
  if (dryRun) {
    console.log('\n(dry-run — no changes written.)')
    return 0
  }
  writeSettings(patch.path, patch.after)
  if (patch.chainedCommand) {
    writeM5ctConfig(homedir(), { chainedStatusLine: patch.chainedCommand })
  }
  console.log(`\nWrote ${patch.path} (backup at ${patch.path}.m5ct-bak).`)
  return 0
}

function runUninstall(args: readonly string[]): number {
  const dryRun = args.includes('--dry-run')
  const chained = readM5ctConfig().chainedStatusLine
  const u = computeUninstall(homedir(), chained)
  if (dryRun) {
    console.log(`(dry-run) would restore statusLine to: ${chained ?? '<removed>'}`)
    return 0
  }
  writeSettings(u.path, u.after)
  console.log(`Restored statusLine to: ${chained ?? '<removed>'} (backup at ${u.path}.m5ct-bak).`)
  return 0
}

export async function runCli(args: readonly string[], io: CliIO = defaultIO): Promise<number> {
  const sub = args[0]
  const rest = args.slice(1)

  if (sub === '--version') {
    if (rest.length > 0) {
      io.error(`unexpected argument: ${rest[0]}`)
      return 2
    }
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
    case 'version': {
      if (rest.length === 0) {
        io.log(runtimeLabel())
        return 0
      }
      if (rest.length === 1 && rest[0] === '--json') {
        io.log(JSON.stringify(runtimeInfo()))
        return 0
      }
      const unexpected = rest[0] === '--json' && rest.length > 1 ? rest[1] : rest[0]
      io.error(`unexpected argument: ${unexpected}`)
      return 2
    }
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
    case 'screenshot':
      return runScreenshot(rest, io)
    case 'tap':
      return runTap(rest, io)
    default:
      // Unreachable: listCommands() gates sub above. Guard against drift.
      io.error(`unknown command: ${sub}`)
      return 2
  }
}

function main(): void {
  runCli(process.argv.slice(2)).then((code) => process.exit(code))
}

// Run main() only when invoked as the entry point. Compare real paths so this
// also fires under symlinked bins (global install / npm link), where argv[1] is
// the symlink but import.meta.url resolves to the real file.
function isEntryPoint(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main()
}
