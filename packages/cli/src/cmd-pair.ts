import { createInterface } from 'node:readline/promises'
import {
  BleUnavailableError,
  type BleAdvertisement,
  type BleCentral,
  createNobleCentral,
  devicesPath,
  pairDevice,
} from '@m5stack-coding-toys/daemon'
import { callOnce, defaultSocket } from './control-client.js'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface PairRunOpts {
  central?: BleCentral
  createCentral?: () => Promise<BleCentral>
  storePath?: string
  socket?: string
  controlCall?: <T = unknown>(sockPath: string, msg: object) => Promise<T>
  nowMs?: number
  confirm?: (device: BleAdvertisement) => Promise<boolean>
  select?: (devices: readonly BleAdvertisement[]) => Promise<BleAdvertisement | undefined>
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  isTty?: boolean
}

export async function runPair(
  args: readonly string[],
  io: IO = console,
  opts: PairRunOpts = {},
): Promise<number> {
  if (args.length > 0) {
    io.error(`unexpected argument: ${args[0]}`)
    return 2
  }
  const sockPath = opts.socket ?? defaultSocket()
  const control = opts.controlCall ?? callOnce
  const safeControl = async (msg: object): Promise<void> => {
    try {
      await control(sockPath, msg)
    } catch {
      // Pairing must also work when m5ctd is not running.
    }
  }

  let central: BleCentral | null = null
  await safeControl({ op: 'pauseBle', client: 'm5ct-pair' })
  try {
    io.log('Scanning for M5Stack devices in pairing mode...')
    central = opts.central ?? (await (opts.createCentral ?? createNobleCentral)())
    const result = await pairDevice({
      central,
      storePath: opts.storePath ?? devicesPath(),
      nowMs: opts.nowMs,
      confirm: opts.confirm ?? ((device) => confirmDevice(device, io, opts)),
      select: opts.select,
    })
    if (result.ok) {
      io.log(`Paired ${result.deviceId} as default device.`)
      await safeControl({ op: 'reloadDevices' })
      await safeControl({ op: 'rescan' })
      return 0
    }
    if (result.error === 'no_devices') {
      io.error('No devices found in pairing mode.')
      io.error('')
      io.error('On the M5Stack waiting screen, enter BLE pairing mode, then run:')
      io.error('  m5ct pair')
      return 1
    }
    if (result.error === 'multiple_devices') {
      io.error('m5ct pair: multiple devices found; choose one explicitly in an interactive terminal')
      return 1
    }
    if (result.error === 'canceled') {
      io.error('m5ct pair: canceled')
      return 1
    }
    io.error('m5ct pair: BLE pairing backend is unavailable')
    return 1
  } catch (err) {
    if (isBleUnavailableError(err)) {
      printBleUnavailable(err, io)
      return 1
    }
    io.error(`m5ct pair: ${(err as Error).message}`)
    return 1
  } finally {
    if (central) await central.close().catch(() => {})
    await safeControl({ op: 'resumeBle', client: 'm5ct-pair' })
  }
}

async function confirmDevice(device: BleAdvertisement, io: IO, opts: PairRunOpts): Promise<boolean> {
  io.log('')
  io.log('Found:')
  io.log(
    `  1. ${device.deviceId}  ${device.name || device.board}  fw ${device.fw ?? '-'}  rssi ${
      device.rssi ?? '-'
    }`,
  )
  if (device.pairCode) io.log(`Confirm code on device: ${device.pairCode}`)
  const stdin = opts.stdin ?? process.stdin
  const stdout = opts.stdout ?? process.stdout
  const isTty = opts.isTty ?? Boolean((stdin as NodeJS.ReadStream).isTTY)
  if (!isTty) return false
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question('Pair this device? [y/N] ')
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

function isBleUnavailableError(err: unknown): err is BleUnavailableError {
  return (
    err instanceof BleUnavailableError ||
    ((err as { name?: unknown; reason?: unknown })?.name === 'BleUnavailableError' &&
      typeof (err as { reason?: unknown }).reason === 'string')
  )
}

function printBleUnavailable(err: BleUnavailableError, io: IO): void {
  if (err.reason === 'powered_off') {
    io.error('m5ct pair: Bluetooth is off. Turn on Bluetooth, then run `m5ct pair` again.')
    return
  }
  if (err.reason === 'permission_denied') {
    io.error('m5ct pair: Bluetooth permission denied.')
    io.error('Grant Bluetooth access to your terminal, Node, or m5ct in macOS Privacy & Security.')
    return
  }
  if (err.reason === 'missing_backend') {
    io.error('m5ct pair: BLE backend is not installed. USB serial still works.')
    return
  }
  io.error(`m5ct pair: ${err.message}`)
}
