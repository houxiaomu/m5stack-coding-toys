import { mkdtempSync } from 'node:fs'
import { connect, createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookServer } from './hook-server.js'

function sockPath() {
  return resolve(mkdtempSync(resolve(tmpdir(), 'm5ct-hs-')), 'd.sock')
}

function rpc(socketPath: string, req: object): Promise<string> {
  return new Promise((res, rej) => {
    const sock = createConnection(socketPath)
    let buf = ''
    sock.on('data', (b: Buffer) => {
      buf += b.toString('utf8')
    })
    sock.on('end', () => res(buf))
    sock.on('error', rej)
    sock.write(`${JSON.stringify(req)}\n`)
  })
}

describe('HookServer', () => {
  it('routes a statusLine frame to the ingest handler and acks', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-srv-'))
    const sockPath = resolve(dir, 'daemon.sock')
    const ingest = vi.fn()
    const server = new HookServer(sockPath)
    server.setStatusLineHandler(ingest)
    await server.listen()
    try {
      const raw = await rpc(sockPath, { statusLine: { model: { display_name: 'X' } } })
      expect(JSON.parse(raw)).toEqual({ ok: true })
      expect(ingest).toHaveBeenCalledWith({ model: { display_name: 'X' } }, expect.any(Object))
    } finally {
      await server.close()
    }
  }, 5000)

  it('forwards ccPid and sessionId alongside the statusLine payload', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-srv-'))
    const sockPath = resolve(dir, 'daemon.sock')
    const seen: Array<{ cc: unknown; ccPid?: number; sessionId?: string }> = []
    const server = new HookServer(sockPath)
    server.setStatusLineHandler((cc, meta) => {
      seen.push({ cc, ccPid: meta.ccPid, sessionId: meta.sessionId })
    })
    await server.listen()
    try {
      await rpc(sockPath, { statusLine: { x: 1 }, ccPid: 777, sessionId: 's1' })
      expect(seen).toEqual([{ cc: { x: 1 }, ccPid: 777, sessionId: 's1' }])
    } finally {
      await server.close()
    }
  }, 5000)

  it('returns an error for an unknown message family', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-srv-'))
    const sockPath = resolve(dir, 'daemon.sock')
    const server = new HookServer(sockPath)
    await server.listen()
    try {
      const raw = await rpc(sockPath, { foo: 'bar' })
      expect(JSON.parse(raw).error).toBe('unknown_message')
    } finally {
      await server.close()
    }
  }, 5000)
})

describe('HookServer hook events', () => {
  let srv: HookServer
  afterEach(async () => {
    await srv?.close()
  })

  it('routes {event} to the hook-event handler and acks', async () => {
    const path = sockPath()
    srv = new HookServer(path)
    const seen: string[] = []
    srv.setHookEventHandler((ev) => seen.push(ev))
    await srv.listen()

    const ack = await new Promise<string>((res) => {
      const s = connect(path, () => s.end(`${JSON.stringify({ event: 'Stop' })}\n`))
      let buf = ''
      s.on('data', (c) => {
        buf += c.toString()
      })
      s.on('close', () => res(buf))
    })
    expect(seen).toEqual(['Stop'])
    expect(JSON.parse(ack)).toEqual({ ok: true })
  })
})
