import { describe, expect, it, vi } from 'vitest'
import { runFlash } from './cmd-flash.js'
import type { PreparedFirmware } from './firmware-source.js'

function io() {
  const logs: string[] = []
  const errs: string[] = []
  return {
    logs,
    errs,
    io: { log: (l: string) => logs.push(l), error: (l: string) => errs.push(l) },
  }
}

const PREP: PreparedFirmware = {
  board: 'cores3-se',
  version: '0.4.0',
  verified: true,
  sourceLabel: 'builtin',
  files: [
    {
      path: '/c/bootloader.bin',
      offset: 0x0,
      name: 'bootloader.bin',
      size: 100,
      sha256: 'a'.repeat(64),
    },
    {
      path: '/c/firmware.bin',
      offset: 0x10000,
      name: 'firmware.bin',
      size: 200,
      sha256: 'c'.repeat(64),
    },
  ],
}

// No daemon socket: a call stub throws "not found" so the daemonRunning=false
// path is taken (the socket file does not exist in CI either).
const noDaemon = async () => {
  throw new Error('daemon socket not found')
}

describe('runFlash flag parsing', () => {
  it('rejects --dir and --manifest-url together with code 2', async () => {
    const t = io()
    const code = await runFlash(['--dir=/x', '--manifest-url=https://y/m.json'], {
      io: t.io,
      call: noDaemon,
    })
    expect(code).toBe(2)
    expect(t.errs.join(' ')).toMatch(/mutually exclusive/)
  })

  it('rejects --dir with no value (code 2)', async () => {
    const t = io()
    const code = await runFlash(['--dir='], {
      io: t.io,
      call: noDaemon,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(2)
    expect(t.errs.join(' ')).toMatch(/--dir requires a path/)
  })

  it('rejects an unknown option (code 2)', async () => {
    const t = io()
    const code = await runFlash(['--bogus'], {
      io: t.io,
      call: noDaemon,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(2)
    expect(t.errs.join(' ')).toMatch(/unknown option/)
  })

  it('dry-run prepares, prints the manifest, and never calls flash or flashHold', async () => {
    const t = io()
    const prepare = vi.fn(async () => PREP)
    const flash = vi.fn(async () => 0)
    const call = vi.fn(noDaemon)
    const code = await runFlash(['--dry-run'], {
      io: t.io,
      prepare,
      call,
      flash,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(0)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(flash).not.toHaveBeenCalled()
    expect(t.logs.join('\n')).toMatch(/would flash 2 files/)
    expect(t.logs.join('\n')).toMatch(/dry-run/)
  })

  it('builds a builtin source by default and runs the flash step', async () => {
    const t = io()
    const prepare = vi.fn(async (src: { kind: string }) => {
      expect(src.kind).toBe('builtin')
      return PREP
    })
    const flash = vi.fn(async () => 0)
    const code = await runFlash([], {
      io: t.io,
      prepare,
      call: noDaemon,
      flash,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(0)
    expect(flash).toHaveBeenCalledTimes(1)
  })

  it('builds a local source when --dir is given', async () => {
    const t = io()
    const prepare = vi.fn(async (src: { kind: string; dir?: string }) => {
      expect(src.kind).toBe('local')
      expect(src.dir).toBe('/tmp/build')
      return { ...PREP, board: null, verified: false, sourceLabel: 'local dir=/tmp/build' }
    })
    const flash = vi.fn(async () => 0)
    const code = await runFlash(['--dir=/tmp/build'], {
      io: t.io,
      prepare,
      call: noDaemon,
      flash,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(0)
    expect(prepare).toHaveBeenCalled()
  })

  it('returns 1 and skips flash when firmware preparation throws', async () => {
    const t = io()
    const prepare = vi.fn(async () => {
      throw new Error('missing firmware.bin in /tmp/build (no manifest.json)')
    })
    const flash = vi.fn(async () => 0)
    const code = await runFlash(['--dir=/tmp/build'], {
      io: t.io,
      prepare,
      call: noDaemon,
      flash,
      socket: '/tmp/m5ct-nope.sock',
    })
    expect(code).toBe(1)
    expect(flash).not.toHaveBeenCalled()
    expect(t.errs.join(' ')).toMatch(/preparation failed/)
  })
})
