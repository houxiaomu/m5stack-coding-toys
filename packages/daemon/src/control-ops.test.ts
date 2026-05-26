import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeControlHandler } from './control-ops.js'
import type { DeviceManager } from './device-manager.js'
import { HookServer } from './hook-server.js'
import type { Router } from './router.js'

function rpc(sockPath: string, msg: object): Promise<string> {
  return new Promise((resolveP, reject) => {
    const c = createConnection(sockPath)
    let buf = ''
    c.on('data', (b: Buffer) => {
      buf += b.toString('utf8')
    })
    c.on('end', () => resolveP(buf))
    c.on('close', () => resolveP(buf))
    c.on('error', reject)
    c.write(`${JSON.stringify(msg)}\n`)
  })
}

function subscribe(
  sockPath: string,
  msg: object,
  onLine: (line: string) => boolean,
): Promise<void> {
  return new Promise((resolveP, reject) => {
    const c = createConnection(sockPath)
    let buf = ''
    c.on('data', (b: Buffer) => {
      buf += b.toString('utf8')
      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (onLine(line)) {
          c.end()
          resolveP()
          return
        }
        nl = buf.indexOf('\n')
      }
    })
    c.on('error', reject)
    c.write(`${JSON.stringify(msg)}\n`)
  })
}

describe('control ops over socket', () => {
  let dir: string
  let sock: string
  let server: HookServer

  const fakeDM = Object.assign(new EventEmitter(), {
    _state: 'Connected' as const,
    state() {
      return this._state
    },
    currentSession() {
      return {
        info: { board: 'X', fw: '0.1.0', caps: ['display'], device_id: 'd' },
        request: async (msg: { k: string }) => {
          if (msg.k === 'tap') return { k: 'tap.ack', p: { ok: true } }
          throw new Error(`unexpected request: ${msg.k}`)
        },
      }
    },
    async flashHold(_c: string) {
      return { ok: true, prevState: 'Connected' as const }
    },
    async flashRelease(_c: string) {
      return { ok: true }
    },
  })

  beforeEach(async () => {
    dir = mkdtempSync(resolve(tmpdir(), 'ctl-'))
    sock = resolve(dir, 'd.sock')
    const dummyRouter = {
      handle: async () => ({ kind: 'fallthrough' as const, reason: '' }),
      handleDeviceEvent: async () => {},
    } as unknown as Router
    server = new HookServer(sock, dummyRouter)
    server.setControl(makeControlHandler(fakeDM as never))
    await server.listen()
  })
  afterEach(async () => {
    await server.close()
  })

  it('status returns snapshot with runtime info', async () => {
    const out = await rpc(sock, { op: 'status' })
    const r = JSON.parse(out) as {
      runtime: { name: string; version: string }
      state: string
      board: string
    }
    expect(r.runtime).toEqual({ name: 'm5ct', version: '0.0.0' })
    expect(r.state).toBe('Connected')
    expect(r.board).toBe('X')
  })

  it('flashHold/Release round trip', async () => {
    const a = JSON.parse(await rpc(sock, { op: 'flashHold', client: 'c1' })) as { ok: boolean }
    expect(a.ok).toBe(true)
    const b = JSON.parse(await rpc(sock, { op: 'flashRelease', client: 'c1' })) as { ok: boolean }
    expect(b.ok).toBe(true)
  })

  it('unknown op returns error', async () => {
    const out = await rpc(sock, { op: 'wat' })
    const r = JSON.parse(out) as { error: string }
    expect(r.error).toMatch(/unknown_op/)
  })

  it('tap round trip', async () => {
    const out = await rpc(sock, { op: 'tap', x: 1, y: 2, duration_ms: 50 })
    expect(JSON.parse(out)).toEqual({ ok: true })
  })

  it('tap rejects malformed request fields', async () => {
    const out = await rpc(sock, { op: 'tap', x: '1', y: 2, duration_ms: 50 })
    expect(JSON.parse(out)).toEqual({ error: 'bad_request' })
  })

  it('subscribe-state streams state events', async () => {
    let count = 0
    await subscribe(sock, { op: 'subscribe-state' }, (line) => {
      const ev = JSON.parse(line) as { event: string; state?: string }
      count++
      if (count === 1) {
        expect(ev.event).toBe('state')
        expect(ev.state).toBe('Connected')
        setImmediate(() => fakeDM.emit('state', 'Cooldown', { from: 'Connected' }))
        return false
      }
      expect(ev.state).toBe('Cooldown')
      return true
    })
  })
})

function dmWith(session: unknown): DeviceManager {
  return { currentSession: () => session } as unknown as DeviceManager
}

describe('screenshot control op', () => {
  it('encodes the raw rgb565 frame into a PNG at the given path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm5shot-'))
    const out = join(dir, 'shot.png')
    // 2×2 rgb565 frame (8 bytes) base64-encoded.
    const data_b64 = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]).toString(
      'base64',
    )
    const session = {
      request: async () => ({
        k: 'screenshot.ack',
        p: { ok: true, w: 2, h: 2, fmt: 'rgb565', data_b64 },
      }),
    }
    const h = makeControlHandler(dmWith(session))
    const r = await h.screenshot(out)
    expect(r).toEqual({ ok: true, path: out })
    // Output is a real PNG: 8-byte signature.
    const bytes = readFileSync(out)
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    rmSync(dir, { recursive: true, force: true })
  })

  it('errors when no device is connected', async () => {
    const h = makeControlHandler(dmWith(null))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'no_device' })
  })

  it('maps a timeout to device_timeout', async () => {
    const session = {
      request: async () => {
        const e = new Error('timed out') as Error & { code?: string }
        e.code = 'ETIMEDOUT'
        throw e
      },
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'device_timeout' })
  })

  it('surfaces a device capture failure', async () => {
    const session = {
      request: async () => ({ k: 'screenshot.ack', p: { ok: false, err: 'capture_unsupported' } }),
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.screenshot('/tmp/x.png')).toEqual({ error: 'capture_unsupported' })
  })
})

describe('tap control op', () => {
  it('errors when no device is connected', async () => {
    const h = makeControlHandler(dmWith(null))
    expect(await h.tap(1, 2, 50)).toEqual({ error: 'no_device' })
  })

  it('returns ok when the device acknowledges the tap', async () => {
    const session = {
      request: async () => ({ k: 'tap.ack', p: { ok: true } }),
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.tap(1, 2, 50)).toEqual({ ok: true })
  })

  it('maps a timeout to device_timeout', async () => {
    const session = {
      request: async () => {
        const e = new Error('timed out') as Error & { code?: string }
        e.code = 'ETIMEDOUT'
        throw e
      },
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.tap(1, 2, 50)).toEqual({ error: 'device_timeout' })
  })

  it('surfaces a device tap rejection', async () => {
    const session = {
      request: async () => ({ k: 'tap.ack', p: { ok: false, err: 'out_of_bounds' } }),
    }
    const h = makeControlHandler(dmWith(session))
    expect(await h.tap(999, 999, 50)).toEqual({ error: 'out_of_bounds' })
  })
})
