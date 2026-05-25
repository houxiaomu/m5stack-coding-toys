import { describe, expect, it, vi } from 'vitest'
import { ensureDaemon } from './bootstrap.js'

const socketPath = '/tmp/m5ct-test/daemon.sock'
const pidPath = '/tmp/m5ct-test/daemon.pid'

describe('ensureDaemon', () => {
  it('does nothing when the socket exists and the daemon pid is alive', () => {
    const spawnFn = vi.fn()
    ensureDaemon({
      socketPath,
      pidPath,
      exists: (path) => path.endsWith('daemon.sock') || path.endsWith('daemon.pid'),
      readFile: () => JSON.stringify({ pid: 123, version: '0.1.0' }),
      alive: (pid) => pid === 123,
      spawnFn,
    })
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('spawns the daemon detached when socket is missing', () => {
    const spawnFn = vi.fn()
    ensureDaemon({ socketPath, pidPath, exists: () => false, spawnFn, daemonCmd: 'm5ctd' })
    expect(spawnFn).toHaveBeenCalledWith('m5ctd')
  })

  it('removes a stale socket and spawns when the pid is dead', () => {
    const spawnFn = vi.fn()
    const unlink = vi.fn()
    ensureDaemon({
      socketPath,
      pidPath,
      exists: (path) => path.endsWith('daemon.sock') || path.endsWith('daemon.pid'),
      readFile: () => JSON.stringify({ pid: 456, version: '0.1.0' }),
      alive: () => false,
      unlink,
      spawnFn,
      daemonCmd: 'm5ctd',
    })
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('daemon.sock'))
    expect(spawnFn).toHaveBeenCalledWith('m5ctd')
  })

  it('removes a stale socket and spawns when the pid file is missing', () => {
    const spawnFn = vi.fn()
    const unlink = vi.fn()
    ensureDaemon({
      socketPath,
      pidPath,
      exists: (path) => path.endsWith('daemon.sock'),
      unlink,
      spawnFn,
      daemonCmd: 'm5ctd',
    })
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('daemon.sock'))
    expect(spawnFn).toHaveBeenCalledWith('m5ctd')
  })
})
