import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const daemonBin = resolve(here, '../dist/main.js')
const fakeFirmware = resolve(here, '../../../tools/fake-firmware/dist/main.js')

interface Harness {
  proc: ChildProcess
  socketPath: string
  /** Captured stdout+stderr of the daemon (and inherited fake-firmware stderr). */
  output: () => string
}

function startDaemon(): Promise<Harness> {
  const dir = mkdtempSync(resolve(tmpdir(), 'm5ct-e2e-'))
  const socketPath = resolve(dir, '.m5stack-coding-toys/daemon.sock')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: dir,
  }
  const fs = require('node:fs') as typeof import('node:fs')
  fs.mkdirSync(resolve(dir, '.m5stack-coding-toys'), { recursive: true })
  fs.writeFileSync(
    resolve(dir, '.m5stack-coding-toys/config.toml'),
    `
[transport]
kind = "fake-stdio"
[transport.fake-stdio]
cmd = ["${process.execPath}", "${fakeFirmware}"]
`,
  )
  const proc = spawn(process.execPath, [daemonBin], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let buf = ''
  return new Promise((resolveP, rejectP) => {
    let resolved = false
    const onLine = (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      if (!resolved && buf.includes('m5ctd up')) {
        resolved = true
        resolveP({ proc, socketPath, output: () => buf })
      }
    }
    proc.stdout?.on('data', onLine)
    proc.stderr?.on('data', onLine)
    proc.on('error', rejectP)
    setTimeout(() => {
      if (!resolved) rejectP(new Error(`daemon never reported listening; output: ${buf}`))
    }, 5000)
  })
}

/** Fire a one-shot frame at the daemon control socket and resolve with the reply. */
function send(socketPath: string, req: object): Promise<string> {
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

function lastFakeStatus(log: string): Record<string, unknown> {
  const lines = log.split('\n').filter((line) => line.includes('[fake-firmware] status '))
  const last = lines.at(-1)
  if (!last) throw new Error(`no fake-firmware status in log: ${log}`)
  return JSON.parse(last.slice(last.indexOf('{')))
}

let h: Harness | null = null

afterEach(async () => {
  if (h) {
    h.proc.kill()
    h = null
  }
})

describe('m5ctd e2e (daemon ↔ fake-firmware via socket)', () => {
  it('forwards a statusLine frame and pushes a status frame to the device', async () => {
    h = await startDaemon()
    // Give the daemon a moment to complete hello with fake-firmware.
    await new Promise((r) => setTimeout(r, 1500))
    const reply = await send(h.socketPath, {
      statusLine: {
        model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
        context_window: { used_percentage: 47 },
        cost: { total_cost_usd: 0.42 },
        workspace: { current_dir: '/tmp' },
      },
    })
    expect(JSON.parse(reply)).toEqual({ ok: true })
    // Allow the push to round-trip to the fake-firmware (logged to stderr).
    await new Promise((r) => setTimeout(r, 800))
    const log = h.output()
    expect(log).toContain('[fake-firmware] status')
    expect(log).toContain('"state":"active"')
    expect(log).toContain('Sonnet 4.6')
  }, 15000)

  it('answers a status control op', async () => {
    h = await startDaemon()
    await new Promise((r) => setTimeout(r, 1500))
    const reply = await send(h.socketPath, { op: 'status' })
    const snap = JSON.parse(reply)
    expect(snap.transport).toBe('fake-stdio')
    expect(snap.board).toBe('cores3-se')
    expect(snap.caps).toContain('display')
  }, 15000)

  it('screenshot op writes the device PNG to disk', async () => {
    h = await startDaemon()
    // Wait for hello handshake with fake-firmware (same delay as existing tests).
    await new Promise((r) => setTimeout(r, 1500))

    // Create a temp dir for the output file and clean it up after the test.
    const outDir = mkdtempSync(resolve(tmpdir(), 'm5ct-e2e-screenshot-'))
    const outPath = resolve(outDir, 'screen.png')
    try {
      const reply = await send(h.socketPath, { op: 'screenshot', out: outPath })
      expect(JSON.parse(reply)).toEqual({ ok: true, path: outPath })

      // The fake-firmware replies with a raw rgb565 frame; the daemon encodes
      // a PNG host-side. Assert the output is a real PNG (8-byte signature).
      const bytes = readFileSync(outPath)
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 15000)

  it('does not foreground another session that needs attention', async () => {
    h = await startDaemon()
    await new Promise((r) => setTimeout(r, 1500))

    await send(h.socketPath, {
      statusLine: {
        session_id: 's1',
        model: { id: 'a', display_name: 'A' },
      },
      ccPid: 111,
      sessionId: 's1',
    })
    await send(h.socketPath, {
      statusLine: {
        session_id: 's2',
        model: { id: 'b', display_name: 'B' },
      },
      ccPid: 222,
      sessionId: 's2',
    })
    await new Promise((r) => setTimeout(r, 300))

    await send(h.socketPath, { event: 'Notification', sessionId: 's2' })
    await new Promise((r) => setTimeout(r, 300))
    const afterS2 = lastFakeStatus(h.output()) as { sessions?: { id: string; activity: string }[] }
    expect(afterS2).toMatchObject({
      activity: 'working',
      model: { short: 'A' },
    })
    expect(afterS2.sessions?.find((s) => s.id === 'pid:222')?.activity).toBe('needs_attention')

    await send(h.socketPath, { event: 'Notification', sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 300))
    expect(lastFakeStatus(h.output())).toMatchObject({
      activity: 'needs_attention',
      model: { short: 'A' },
    })
  }, 15000)

  it('reports terminal rows by pid when one pid changes Claude session id', async () => {
    h = await startDaemon()
    await new Promise((r) => setTimeout(r, 1500))

    await send(h.socketPath, {
      statusLine: {
        session_id: 's1',
        model: { id: 'a', display_name: 'A' },
        workspace: { current_dir: '/repo/pm' },
      },
      ccPid: 83876,
      sessionId: 's1',
    })
    await send(h.socketPath, {
      statusLine: {
        session_id: 's2',
        model: { id: 'b', display_name: 'B' },
        workspace: { current_dir: '/repo/pm' },
      },
      ccPid: 83876,
      sessionId: 's2',
    })
    await send(h.socketPath, {
      statusLine: {
        session_id: 's3',
        model: { id: 'c', display_name: 'C' },
        workspace: { current_dir: '/repo/m5toys' },
      },
      ccPid: 34930,
      sessionId: 's3',
    })
    await new Promise((r) => setTimeout(r, 500))

    const status = lastFakeStatus(h.output()) as { focus?: unknown; sessions?: unknown[] }
    expect(status.focus).toBeUndefined()
    expect(status.sessions?.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([
      ['pid:83876', 'pm'],
      ['pid:34930', 'm5toys'],
    ])
  }, 15000)
})
