import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export interface M5ctConfig {
  /** The statusLine command m5ct displaced at install time, replayed by the shim. */
  chainedStatusLine?: string
  [key: string]: unknown
}

export function installStatePath(home: string = homedir()): string {
  return resolve(home, '.m5stack-coding-toys', 'install-state.json')
}

export function readM5ctConfig(home: string = homedir()): M5ctConfig {
  const path = installStatePath(home)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as M5ctConfig
  } catch {
    return {}
  }
}

export function writeM5ctConfig(home: string, patch: M5ctConfig): void {
  const path = installStatePath(home)
  mkdirSync(dirname(path), { recursive: true })
  const merged = { ...readM5ctConfig(home), ...patch }
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`)
}
