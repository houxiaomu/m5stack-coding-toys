import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export interface SettingsPatch {
  /** Path to the settings.json file. */
  path: string
  /** Existing settings (or {} if missing). */
  before: Record<string, unknown>
  /** Proposed settings with the m5ct statusLine merged. */
  after: Record<string, unknown>
  /** Newly added entries (for human review). Empty when already installed. */
  added: { field: string; command: string }[]
  /** The pre-existing third-party statusLine command we displaced, to chain. */
  chainedCommand?: string
}

interface StatusLineConfig {
  type: string
  command: string
  padding?: number
}

export function settingsPath(home: string = homedir()): string {
  return resolve(home, '.claude/settings.json')
}

export function computeInstallPatch(
  home: string = homedir(),
  statusLineBin = 'm5ct-statusline',
): SettingsPatch {
  const path = settingsPath(home)
  const before: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {}

  const desired: StatusLineConfig = { type: 'command', command: statusLineBin, padding: 0 }
  const current = before.statusLine as StatusLineConfig | undefined
  const added: { field: string; command: string }[] = []

  let after: Record<string, unknown> = before
  let chainedCommand: string | undefined
  if (!current || current.command !== desired.command) {
    if (current?.command && current.command !== desired.command) {
      chainedCommand = current.command
    }
    after = { ...before, statusLine: desired }
    added.push({ field: 'statusLine', command: statusLineBin })
  }

  const existingHooks =
    after.hooks && typeof after.hooks === 'object'
      ? (after.hooks as Record<string, unknown>)
      : {}
  for (const event of HOOK_EVENTS) {
    const cmd = `${statusLineBin} --event ${event}`
    const groups = Array.isArray(existingHooks[event])
      ? (existingHooks[event] as { hooks?: { command: string }[] }[])
      : []
    const present = groups.some((g) => g.hooks?.some((h) => h.command === cmd))
    if (!present) added.push({ field: `hooks.${event}`, command: cmd })
  }
  after = { ...after, hooks: computeHooksPatch(existingHooks, statusLineBin) }

  return { path, before, after, added, chainedCommand }
}

export const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'] as const

interface HookGroup {
  hooks: { type: string; command: string }[]
  [k: string]: unknown
}

function hookCommand(bin: string, event: string): string {
  return `${bin} --event ${event}`
}

/** Merge our three CC hooks into an existing `hooks` object, preserving others
 *  and never duplicating our own group. Returns the new hooks object. */
export function computeHooksPatch(
  before: Record<string, unknown>,
  bin: string,
): Record<string, unknown> {
  const after: Record<string, unknown> = { ...before }
  for (const event of HOOK_EVENTS) {
    const cmd = hookCommand(bin, event)
    const groups = (Array.isArray(after[event]) ? [...(after[event] as HookGroup[])] : []) as HookGroup[]
    const already = groups.some((g) => g.hooks?.some((h) => h.command === cmd))
    if (!already) groups.push({ hooks: [{ type: 'command', command: cmd }] })
    after[event] = groups
  }
  return after
}

/** Remove only our hook groups; drop an event key that ends up empty. */
export function computeHooksUninstall(
  before: Record<string, unknown>,
  bin: string,
): Record<string, unknown> {
  const after: Record<string, unknown> = { ...before }
  for (const event of HOOK_EVENTS) {
    if (!Array.isArray(after[event])) continue
    const cmd = hookCommand(bin, event)
    const kept = (after[event] as HookGroup[]).filter(
      (g) => !g.hooks?.some((h) => h.command === cmd),
    )
    if (kept.length > 0) after[event] = kept
    else delete after[event]
  }
  return after
}

export interface UninstallPatch {
  path: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

/** Restore the chained command (if any) or drop statusLine entirely. */
export function computeUninstall(home: string = homedir(), chained?: string): UninstallPatch {
  const path = settingsPath(home)
  const before: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
    : {}
  const after = { ...before }
  if (chained) {
    after.statusLine = { type: 'command', command: chained, padding: 0 }
  } else {
    after.statusLine = undefined
  }
  if (after.hooks && typeof after.hooks === 'object') {
    const stripped = computeHooksUninstall(after.hooks as Record<string, unknown>, 'm5ct-statusline')
    after.hooks = Object.keys(stripped).length > 0 ? stripped : undefined
  }
  return { path, before, after }
}

/** Back up settings.json (only the first time, to preserve the pristine copy) then write `after`. */
export function writeSettings(path: string, after: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const backup = `${path}.m5ct-bak`
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup)
  writeFileSync(path, `${JSON.stringify(after, null, 2)}\n`)
}
