import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { SerialPort } from 'serialport'
import { type DaemonStatus, callOnce, defaultSocket } from './control-client.js'
import {
  type FlashSource,
  type PreparedFile,
  type PreparedFirmware,
  prepareFirmware,
} from './firmware-source.js'
import { Flasher } from './flasher.js'
import type { CliIO } from './main.js'

const defaultIO: CliIO = { log: (l) => console.log(l), error: (l) => console.error(l) }

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) =>
    rl.question(question, (a) => {
      rl.close()
      res(a)
    }),
  )
}

async function findBootloaderPort(vendorId = '303a', timeoutMs = 30000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ports = await SerialPort.list()
    const m = ports.find((p) => (p.vendorId ?? '').toLowerCase() === vendorId)
    if (m) return m.path
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no Espressif port appeared within ${timeoutMs}ms`)
}

// The real flash step: wait for download mode, scan for the bootloader port,
// erase, write, watchdog-reset. Injectable so tests never touch a serial port.
async function defaultFlashStep(files: PreparedFile[], io: CliIO): Promise<number> {
  io.log('')
  io.log('⚠  Long-press RESET for 3s to enter download mode.')
  io.log('   Screen goes black with a green LED blink.')
  await ask('   Press Enter when ready (Ctrl-C to abort): ')

  io.log('m5ct: scanning for bootloader port...')
  const port = await findBootloaderPort()
  io.log(`m5ct: found ${port}`)

  const flasher = new Flasher({ port })
  const { chip } = await flasher.open()
  io.log(`m5ct: chip=${chip}`)
  io.log('m5ct: erasing...')
  await flasher.erase()
  io.log('m5ct: writing files:')
  let lastPct = -10
  await flasher.write(
    files.map((f) => ({ path: f.path, offset: f.offset })),
    ({ file, written, total }) => {
      const pct = Math.floor((written / total) * 100)
      if (pct >= lastPct + 5 || pct === 100) {
        process.stdout.write(`\r  ${file.split('/').pop()}  ${pct}%`)
        lastPct = pct
      }
    },
  )
  process.stdout.write('\n')
  io.log('m5ct: booting firmware via watchdog reset...')
  await flasher.resetAfterFlash()
  await flasher.close()
  io.log('m5ct: flash complete; firmware is booting.')
  return 0
}

export interface FlashDeps {
  prepare?: typeof prepareFirmware
  call?: (sockPath: string, msg: object) => Promise<unknown>
  io?: CliIO
  flash?: (files: PreparedFile[], io: CliIO) => Promise<number>
  socket?: string
}

interface ParsedFlags {
  board?: string
  fw?: string
  dir?: string
  manifestUrl?: string
  dryRun: boolean
  force: boolean
}

// Returns the parsed flags, or a number exit code (2) on a parse error (already
// reported through io).
function parseFlags(args: readonly string[], io: CliIO): ParsedFlags | number {
  const flags: ParsedFlags = { dryRun: false, force: false }
  for (const a of args) {
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--force') flags.force = true
    else if (a === '--dir' || a === '--manifest-url') {
      io.error(`m5ct flash: ${a} requires a ${a === '--dir' ? 'path' : 'URL'}`)
      return 2
    } else if (a.startsWith('--board=')) flags.board = a.slice('--board='.length)
    else if (a.startsWith('--fw=')) flags.fw = a.slice('--fw='.length)
    else if (a.startsWith('--dir=')) flags.dir = a.slice('--dir='.length)
    else if (a.startsWith('--manifest-url=')) flags.manifestUrl = a.slice('--manifest-url='.length)
    else {
      io.error(`m5ct flash: unknown option: ${a}`)
      return 2
    }
  }
  if (flags.dir !== undefined && flags.manifestUrl !== undefined) {
    io.error('m5ct flash: --dir and --manifest-url are mutually exclusive')
    return 2
  }
  if (flags.dir === '') {
    io.error('m5ct flash: --dir requires a path')
    return 2
  }
  if (flags.manifestUrl === '') {
    io.error('m5ct flash: --manifest-url requires a URL')
    return 2
  }
  return flags
}

export async function runFlash(args: readonly string[], deps: FlashDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIO
  const prepare = deps.prepare ?? prepareFirmware
  const call = deps.call ?? ((s: string, m: object) => callOnce<unknown>(s, m))
  const flashStep = deps.flash ?? defaultFlashStep
  const sockPath = deps.socket ?? defaultSocket()

  const parsed = parseFlags(args, io)
  if (typeof parsed === 'number') return parsed
  const flags = parsed

  let daemonRunning = false
  let daemonBoard: string | null = null
  if (existsSync(sockPath)) {
    try {
      const status = (await call(sockPath, { op: 'status' })) as DaemonStatus
      daemonRunning = true
      daemonBoard = status.board ?? null
      io.log(`m5ct: daemon reports state=${status.state} board=${status.board} fw=${status.fw}`)
    } catch (e) {
      io.error(`m5ct: daemon socket exists but unresponsive (${(e as Error).message})`)
    }
  }

  if ((flags.dir !== undefined || flags.manifestUrl !== undefined) && flags.fw !== undefined) {
    io.log('m5ct: warning: --fw is ignored when --dir or --manifest-url is given')
  }

  const board = flags.board ?? daemonBoard ?? 'cores3-se'
  let source: FlashSource
  if (flags.dir !== undefined) source = { kind: 'local', dir: flags.dir, board: flags.board }
  else if (flags.manifestUrl !== undefined)
    source = { kind: 'remote', manifestUrl: flags.manifestUrl, board: flags.board }
  else source = { kind: 'builtin', board, fw: flags.fw }

  const cacheDir = resolve(homedir(), '.m5stack-coding-toys', 'firmware')
  let prepared: PreparedFirmware
  try {
    prepared = await prepare(source, cacheDir)
  } catch (e) {
    io.error(`m5ct: firmware preparation failed: ${(e as Error).message}`)
    return 1
  }

  const boardLabel = prepared.board ?? 'unknown'
  io.log(
    `m5ct: source=${prepared.sourceLabel} board=${boardLabel} fw=${prepared.version ?? '?'} verified=${prepared.verified ? 'yes' : 'no'}`,
  )

  // board consistency check: refuse to flash a board's firmware onto a different
  // connected board unless --force.
  if (daemonRunning && daemonBoard && prepared.board && prepared.board !== daemonBoard) {
    if (!flags.force) {
      io.error(
        `m5ct: source board=${prepared.board} does not match connected device board=${daemonBoard}; pass --force to override`,
      )
      return 1
    }
    io.log(
      `m5ct: warning: source board=${prepared.board} but daemon reports board=${daemonBoard} (--force)`,
    )
  }

  if (flags.dryRun) {
    io.log(`m5ct: would flash ${prepared.files.length} files:`)
    for (const f of prepared.files) {
      const tag = f.sha256 ? 'sha256 ✓' : 'sha256 —'
      io.log(`  ${f.name}  @0x${f.offset.toString(16)}  ${f.size} bytes  ${tag}`)
    }
    io.log('m5ct: dry-run — no device action taken.')
    return 0
  }

  const clientId = `m5ct-flash@pid${process.pid}`
  if (daemonRunning) {
    const r = (await call(sockPath, { op: 'flashHold', client: clientId })) as {
      ok: boolean
      error?: string
      heldBy?: string
    }
    if (!r.ok) {
      io.error(`m5ct: flashHold failed: ${r.error}${r.heldBy ? ` (heldBy=${r.heldBy})` : ''}`)
      return 1
    }
    io.log('m5ct: daemon released port')
  }

  try {
    return await flashStep(prepared.files, io)
  } catch (err) {
    io.error(`m5ct: flash failed: ${(err as Error).message}`)
    return 1
  } finally {
    if (daemonRunning) {
      try {
        await call(sockPath, { op: 'flashRelease', client: clientId })
      } catch (e) {
        io.error(`m5ct: flashRelease error: ${(e as Error).message}`)
      }
    }
  }
}
