#!/usr/bin/env node

import { homedir } from 'node:os'
import { runFlash } from './cmd-flash.js'
import { runStatus } from './cmd-status.js'
import { runWatch } from './cmd-watch.js'
import { computeInstallPatch, computeUninstall, writeSettings } from './install.js'
import { readM5ctConfig, writeM5ctConfig } from './m5ct-config.js'

export function listCommands(): readonly string[] {
  return [
    'pair',
    'devices',
    'use',
    'forget',
    'status',
    'watch',
    'flash',
    'log',
    'install',
    'uninstall',
  ] as const
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

function main(): void {
  const sub = process.argv[2]
  const rest = process.argv.slice(3)
  if (!sub) {
    console.log(`usage: m5ct <${listCommands().join('|')}>`)
    process.exit(2)
  }
  if (!listCommands().includes(sub)) {
    console.error(`unknown command: ${sub}`)
    process.exit(2)
  }
  switch (sub) {
    case 'install':
      process.exit(runInstall(rest))
      break
    case 'uninstall':
      process.exit(runUninstall(rest))
      break
    case 'status':
      runStatus({ json: rest.includes('--json') }).then((c) => process.exit(c))
      break
    case 'watch':
      runWatch().then((c) => process.exit(c))
      break
    case 'flash':
      runFlash(rest).then((c) => process.exit(c))
      break
    default:
      console.log(`m5ct ${sub}: not yet implemented`)
      process.exit(0)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
