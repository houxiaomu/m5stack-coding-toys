import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type LockInfo, acquireLock, readLock, releaseLock, shouldExitIdle } from './singleton.js'

function tmpLock(): string {
  return resolve(mkdtempSync(resolve(tmpdir(), 'm5ct-lock-')), 'daemon.lock')
}

describe('acquireLock', () => {
  it('acquires when no lock file exists', () => {
    const path = tmpLock()
    const r = acquireLock(path, { pid: 100, version: '1.0.0' }, () => true)
    expect(r.outcome).toBe('acquired')
    const onDisk = readLock(path) as LockInfo
    expect(onDisk.pid).toBe(100)
    expect(onDisk.version).toBe('1.0.0')
  })

  it('reports running when a live daemon of same version holds the lock', () => {
    const path = tmpLock()
    writeFileSync(path, JSON.stringify({ pid: 200, version: '1.0.0', startedAt: 1 }))
    const r = acquireLock(path, { pid: 300, version: '1.0.0' }, (pid) => pid === 200)
    expect(r.outcome).toBe('running')
    if (r.outcome === 'running') expect(r.holder.pid).toBe(200)
    expect((readLock(path) as LockInfo).pid).toBe(200) // not overwritten
  })

  it('takes over a stale lock whose pid is dead', () => {
    const path = tmpLock()
    writeFileSync(path, JSON.stringify({ pid: 999, version: '1.0.0', startedAt: 1 }))
    const r = acquireLock(path, { pid: 400, version: '1.0.0' }, () => false)
    expect(r.outcome).toBe('acquired')
    expect((readLock(path) as LockInfo).pid).toBe(400)
  })

  it('takes over when a live holder runs a different version (upgrade)', () => {
    const path = tmpLock()
    writeFileSync(path, JSON.stringify({ pid: 200, version: '1.0.0', startedAt: 1 }))
    const r = acquireLock(path, { pid: 500, version: '2.0.0' }, () => true)
    expect(r.outcome).toBe('superseded')
    if (r.outcome === 'superseded') expect(r.holder.pid).toBe(200)
  })

  it('readLock returns null on missing or corrupt file', () => {
    expect(readLock(tmpLock())).toBeNull()
    const path = tmpLock()
    writeFileSync(path, 'not json')
    expect(readLock(path)).toBeNull()
  })

  it('releases the lock only when the pid matches', () => {
    const path = tmpLock()
    writeFileSync(path, JSON.stringify({ pid: 600, version: '1.0.0', startedAt: 1 }))
    expect(releaseLock(path, 601)).toBe(false)
    expect(existsSync(path)).toBe(true)
    expect(releaseLock(path, 600)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })
})

describe('shouldExitIdle', () => {
  const idleMs = 10 * 60_000
  it('false when a device session is connected', () => {
    expect(
      shouldExitIdle({ now: 1_000_000, lastActivityMs: 0, idleMs, deviceConnected: true }),
    ).toBe(false)
  })
  it('false when last activity is within the idle window', () => {
    expect(shouldExitIdle({ now: 1000, lastActivityMs: 500, idleMs, deviceConnected: false })).toBe(
      false,
    )
  })
  it('true when no device and idle window exceeded', () => {
    expect(
      shouldExitIdle({ now: idleMs + 2000, lastActivityMs: 1000, idleMs, deviceConnected: false }),
    ).toBe(true)
  })
})
