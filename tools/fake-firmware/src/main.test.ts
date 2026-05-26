import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NdjsonFramer, decode, encode } from '@m5stack-coding-toys/protocol'
import { describe, expect, it } from 'vitest'
import { boardId } from './main.js'

const here = dirname(fileURLToPath(import.meta.url))
const binPath = resolve(here, '../dist/main.js')

function runFake(boardArgs: readonly string[] = []): {
  send: (line: string) => void
  recv: Promise<string>
  kill: () => void
} {
  const proc = spawn(process.execPath, [binPath, ...boardArgs], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const framer = new NdjsonFramer()
  let resolver: ((s: string) => void) | null = null
  const recv = new Promise<string>((r) => {
    resolver = r
  })
  proc.stdout.on('data', (chunk: Buffer) => {
    const lines = framer.push(chunk)
    if (lines.length > 0 && resolver) {
      resolver(lines[0] as string)
      resolver = null
    }
  })
  return {
    send: (line: string) => proc.stdin.write(`${line}\n`),
    recv,
    kill: () => proc.kill(),
  }
}

describe('boardId', () => {
  it('defaults to cores3-se', () => {
    expect(boardId([])).toBe('cores3-se')
  })

  it('accepts --board cardputer-adv', () => {
    expect(boardId(['--board', 'cardputer-adv'])).toBe('cardputer-adv')
  })

  it('throws on invalid --board', () => {
    expect(() => boardId(['--board', 'bogus'])).toThrow()
  })
})

describe('fake-firmware e2e', () => {
  it('responds to hello with hello.ack', async () => {
    const fake = runFake([])
    try {
      const hello = encode({ k: 'hello', id: 'h1', p: { caps: ['display', 'notify'] } })
      fake.send(hello)
      const reply = await fake.recv
      const env = decode(reply)
      expect(env.k).toBe('hello.ack')
      expect(env.id).toBe('h1')
      const p = env.p as { board: string; caps: string[]; device_id: string }
      expect(p.board).toBe('cores3-se')
      expect(p.device_id).toMatch(/^FAKE-/)
    } finally {
      fake.kill()
    }
  }, 5000)

  it('uses --board override', async () => {
    const fake = runFake(['--board', 'cardputer-adv'])
    try {
      fake.send(encode({ k: 'hello', id: 'h2', p: { caps: [] } }))
      const reply = await fake.recv
      const env = decode(reply)
      const p = env.p as { board: string }
      expect(p.board).toBe('cardputer-adv')
    } finally {
      fake.kill()
    }
  }, 5000)

  it('replies screenshot.ack to a screenshot request', async () => {
    const fake = runFake([])
    try {
      fake.send(encode({ k: 'screenshot', id: 'm1', p: { fmt: 'png' } }))
      const reply = await fake.recv
      const env = decode(reply)
      expect(env.k).toBe('screenshot.ack')
      expect(env.id).toBe('m1')
      const p = env.p as { ok: boolean; fmt?: string; data_b64?: string }
      expect(p.ok).toBe(true)
      expect(p.fmt).toBe('rgb565')
      expect(typeof p.data_b64).toBe('string')
    } finally {
      fake.kill()
    }
  }, 5000)
})
