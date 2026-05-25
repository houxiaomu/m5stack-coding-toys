import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

export interface LockInfo {
  pid: number
  version: string
  startedAt: number
}

export type AliveFn = (pid: number) => boolean

export function defaultAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readLock(path: string): LockInfo | null {
  if (!existsSync(path)) return null
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockInfo>
    if (typeof o.pid === 'number' && typeof o.version === 'string') {
      return { pid: o.pid, version: o.version, startedAt: o.startedAt ?? 0 }
    }
  } catch {
    // corrupt → treat as absent
  }
  return null
}

export type AcquireResult =
  | { outcome: 'acquired' }
  | { outcome: 'running'; holder: LockInfo }
  | { outcome: 'superseded'; holder: LockInfo }

/**
 * Try to claim the singleton lock for this process.
 * - acquired: no live holder (or stale/corrupt) → we wrote our own lock.
 * - running: a live holder of the SAME version exists → caller should exit 0.
 * - superseded: a live holder of a DIFFERENT version exists → caller should
 *   signal it to quit, then re-acquire (we already wrote our own lock).
 */
export function acquireLock(
  path: string,
  self: { pid: number; version: string },
  alive: AliveFn = defaultAlive,
): AcquireResult {
  const holder = readLock(path)
  if (holder && alive(holder.pid)) {
    if (holder.version === self.version) return { outcome: 'running', holder }
    write(path, self)
    return { outcome: 'superseded', holder }
  }
  write(path, self)
  return { outcome: 'acquired' }
}

export function releaseLock(path: string, pid: number = process.pid): boolean {
  const holder = readLock(path)
  if (!holder || holder.pid !== pid) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

function write(path: string, self: { pid: number; version: string }): void {
  const info: LockInfo = { pid: self.pid, version: self.version, startedAt: Date.now() }
  writeFileSync(path, JSON.stringify(info))
}

export interface IdleCheck {
  now: number
  lastActivityMs: number
  idleMs: number
  deviceConnected: boolean
}

/** Exit only when no device is linked AND no socket activity for idleMs. */
export function shouldExitIdle({
  now,
  lastActivityMs,
  idleMs,
  deviceConnected,
}: IdleCheck): boolean {
  if (deviceConnected) return false
  return now - lastActivityMs > idleMs
}
