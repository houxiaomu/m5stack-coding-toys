import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { SerialPort } from 'serialport'
import { type DaemonStatus, callOnce, defaultSocket } from './control-client.js'
import { resolveFirmware } from './firmware-index.js'
import { ensureFirmware } from './firmware-store.js'
import { Flasher } from './flasher.js'

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

export async function runFlash(args: readonly string[]): Promise<number> {
  const sockPath = defaultSocket()
  const boardArg = args.find((a) => a.startsWith('--board='))?.split('=')[1]
  let board = boardArg
  let daemonRunning = false
  if (existsSync(sockPath)) {
    try {
      const status = await callOnce<DaemonStatus>(sockPath, { op: 'status' })
      daemonRunning = true
      board = board ?? status.board ?? undefined
      console.log(
        `m5ct: daemon reports state=${status.state} board=${status.board} fw=${status.fw}`,
      )
    } catch (e) {
      console.error(`m5ct: daemon socket exists but unresponsive (${(e as Error).message})`)
    }
  }
  if (!board) board = 'cores3-se'
  const fwVersion = args.find((a) => a.startsWith('--fw='))?.split('=')[1]
  const cacheDir = resolve(homedir(), '.m5stack-coding-toys', 'firmware')
  const entry = resolveFirmware(board, fwVersion)
  console.log(`m5ct: firmware ${board} fw=${entry.version} (downloading/verifying if needed)...`)
  const files = await ensureFirmware(entry, cacheDir)
  console.log(`m5ct: firmware ready in cache (${files.length} files)`)

  const clientId = `m5ct-flash@pid${process.pid}`
  if (daemonRunning) {
    const r = await callOnce<{ ok: boolean; error?: string; heldBy?: string }>(sockPath, {
      op: 'flashHold',
      client: clientId,
    })
    if (!r.ok) {
      console.error(`m5ct: flashHold failed: ${r.error}${r.heldBy ? ` (heldBy=${r.heldBy})` : ''}`)
      return 1
    }
    console.log('m5ct: daemon released port')
  }

  try {
    console.log('')
    console.log('⚠  Long-press RESET for 3s to enter download mode.')
    console.log('   Screen goes black with a green LED blink.')
    await ask('   Press Enter when ready (Ctrl-C to abort): ')

    console.log('m5ct: scanning for bootloader port...')
    const port = await findBootloaderPort()
    console.log(`m5ct: found ${port}`)

    const flasher = new Flasher({ port })
    const { chip } = await flasher.open()
    console.log(`m5ct: chip=${chip}`)
    console.log('m5ct: erasing...')
    await flasher.erase()
    console.log('m5ct: writing files:')
    let lastPct = -10
    await flasher.write(files, ({ file, written, total }) => {
      const pct = Math.floor((written / total) * 100)
      if (pct >= lastPct + 5 || pct === 100) {
        process.stdout.write(`\r  ${file.split('/').pop()}  ${pct}%`)
        lastPct = pct
      }
    })
    process.stdout.write('\n')
    console.log('m5ct: booting firmware via watchdog reset...')
    await flasher.resetAfterFlash()
    await flasher.close()
    console.log('m5ct: flash complete; firmware is booting.')
    return 0
  } catch (err) {
    console.error(`m5ct: flash failed: ${(err as Error).message}`)
    return 1
  } finally {
    if (daemonRunning) {
      try {
        await callOnce(sockPath, { op: 'flashRelease', client: clientId })
      } catch (e) {
        console.error(`m5ct: flashRelease error: ${(e as Error).message}`)
      }
    }
  }
}
