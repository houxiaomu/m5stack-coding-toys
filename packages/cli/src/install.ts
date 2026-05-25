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

  return { path, before, after, added, chainedCommand }
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
  return { path, before, after }
}

/** Back up settings.json (only the first time, to preserve the pristine copy) then write `after`. */
export function writeSettings(path: string, after: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  const backup = `${path}.m5ct-bak`
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup)
  writeFileSync(path, `${JSON.stringify(after, null, 2)}\n`)
}
