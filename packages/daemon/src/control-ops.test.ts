import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeControlHandler } from './control-ops.js'
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
