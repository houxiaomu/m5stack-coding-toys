import { describe, expect, it, vi } from 'vitest'
import { ensureDaemon } from './bootstrap.js'

describe('ensureDaemon', () => {
  it('does nothing when the socket already exists', () => {
    const spawnFn = vi.fn()
    ensureDaemon({ socketExists: () => true, spawnFn })
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('spawns the daemon detached when socket is missing', () => {
    const spawnFn = vi.fn()
    ensureDaemon({ socketExists: () => false, spawnFn, daemonCmd: 'm5ctd' })
    expect(spawnFn).toHaveBeenCalledWith('m5ctd')
  })
})
