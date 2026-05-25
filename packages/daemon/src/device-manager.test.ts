import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceManager, type ManagerState } from './device-manager.js'

class FakePoller extends EventEmitter {
  started = false
  stopCount = 0
  start(): void {
    this.started = true
  }
  stop(): void {
    this.stopCount++
    this.started = false
  }
}

function makeTransportFactory(opens: ('ok' | 'fail')[]) {
  let i = 0
  return (_path: string) => {
    const outcome = opens[i++] ?? 'ok'
    const t = new EventEmitter() as EventEmitter & {
      open: () => Promise<void>
      close: () => Promise<void>
      write: (b: Buffer | string) => Promise<void>
      connected: boolean
      label: string
    }
    t.connected = false
    t.label = `fake:${i}`
    t.open = async () => {
      if (outcome === 'fail') throw new Error('open failed')
      t.connected = true
    }
    t.close = async () => {
      t.connected = false
    }
    t.write = async () => {}
    return t
  }
}

function makeSessionFactory(helloOutcome: 'ok' | 'fail') {
  return (transport: EventEmitter & { open: () => Promise<void> }) => {
    const s = new EventEmitter() as EventEmitter & {
      start: () => Promise<unknown>
      destroy: () => void
      hasCap: (cap: string) => boolean
      send: (msg: unknown) => Promise<void>
      info: { board: string; fw: string; caps: readonly string[]; device_id: string } | null
    }
    s.info = null
    s.start = async () => {
      await transport.open()
      if (helloOutcome === 'fail') throw new Error('hello fail')
      s.info = {
        board: 'cores3-se',
        fw: '0.2.0',
        caps: ['display', 'bar'],
        device_id: 'X',
      }
      return s.info
    }
    s.hasCap = (cap) => s.info?.caps.includes(cap) ?? false
    s.send = async () => {}
    s.destroy = () => {
      transport.emit('close')
    }
    return s
  }
}

describe('DeviceManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts in Scanning and runs poller', () => {
    const poller = new FakePoller()
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
    })
    dm.start()
    expect(dm.state()).toBe<ManagerState>('Scanning')
    expect(poller.started).toBe(true)
    dm.stop()
  })

  it('attached event drives Scanning → Opening → Handshaking → Connected', async () => {
    const poller = new FakePoller()
    const states: ManagerState[] = []
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
    })
    dm.on('state', (s: ManagerState) => states.push(s))
    dm.start()
    poller.emit('attached', { path: '/dev/cu.x', vendorId: '303a', productId: '1001' })
    await vi.advanceTimersByTimeAsync(50)
    expect(states).toContain('Opening')
    expect(states).toContain('Handshaking')
    expect(states).toContain('Connected')
    expect(dm.currentSession()).not.toBeNull()
    expect(poller.stopCount).toBeGreaterThan(0)
    dm.stop()
  })

  it('hello failure → Cooldown with backoff, then Scanning', async () => {
    const poller = new FakePoller()
    const states: ManagerState[] = []
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('fail') as never,
      backoffMs: [100, 200],
    })
    dm.on('state', (s: ManagerState) => states.push(s))
    dm.start()
    poller.emit('attached', { path: '/dev/cu.x', vendorId: '303a', productId: '1001' })
    await vi.advanceTimersByTimeAsync(20)
    expect(states).toContain('Cooldown')
    await vi.advanceTimersByTimeAsync(150)
    expect(dm.state()).toBe<ManagerState>('Scanning')
    dm.stop()
  })

  it('disconnect in Connected → Cooldown', async () => {
    const poller = new FakePoller()
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
      backoffMs: [50],
    })
    dm.start()
    poller.emit('attached', { path: '/dev/cu.x', vendorId: '303a', productId: '1001' })
    await vi.advanceTimersByTimeAsync(20)
    expect(dm.state()).toBe<ManagerState>('Connected')
    const sess = dm.currentSession() as unknown as EventEmitter
    sess.emit('disconnect')
    expect(dm.state()).toBe<ManagerState>('Cooldown')
    expect(dm.currentSession()).toBeNull()
    dm.stop()
  })

  it('flashHold from Connected → Held; flashRelease → Scanning', async () => {
    const poller = new FakePoller()
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
      heldTimeoutMs: 1000,
    })
    dm.start()
    poller.emit('attached', { path: '/dev/cu.x', vendorId: '303a', productId: '1001' })
    await vi.advanceTimersByTimeAsync(20)
    const r1 = await dm.flashHold('cli1')
    expect(r1.ok).toBe(true)
    expect(dm.state()).toBe<ManagerState>('Held')
    expect(dm.currentSession()).toBeNull()
    const r2 = await dm.flashRelease('cli1')
    expect(r2.ok).toBe(true)
    expect(dm.state()).toBe<ManagerState>('Scanning')
    dm.stop()
  })

  it('emits drift event when profile reports non-none', async () => {
    const poller = new FakePoller()
    const profile = {
      driftLevel: () => 'minor' as const,
      expectedVersion: () => '0.3.0',
    } as never
    const drifts: unknown[] = []
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
      profile,
    })
    dm.on('drift', (e: unknown) => drifts.push(e))
    dm.start()
    poller.emit('attached', { path: '/dev/cu.x', vendorId: '303a', productId: '1001' })
    await vi.advanceTimersByTimeAsync(20)
    expect(drifts).toHaveLength(1)
    dm.stop()
  })

  it('flashHold rejects second client', async () => {
    const poller = new FakePoller()
    const dm = new DeviceManager({
      poller: poller as unknown as never,
      transportFactory: makeTransportFactory(['ok']) as never,
      sessionFactory: makeSessionFactory('ok') as never,
    })
    dm.start()
    await dm.flashHold('cli1')
    const r2 = await dm.flashHold('cli2')
    expect(r2.ok).toBe(false)
    expect(r2.error).toBe('already_held')
    expect(r2.heldBy).toBe('cli1')
    dm.stop()
  })
})
