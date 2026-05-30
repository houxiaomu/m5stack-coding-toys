import { type BleAdvertisement, type BleCentral, pairDevice } from '@m5stack-coding-toys/daemon'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface PairRunOpts {
  central?: BleCentral
  storePath?: string
  nowMs?: number
  confirm?: (device: BleAdvertisement) => Promise<boolean>
  select?: (devices: readonly BleAdvertisement[]) => Promise<BleAdvertisement | undefined>
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
  if (!opts.central || !opts.storePath) {
    io.error('m5ct pair: BLE pairing backend is unavailable')
    return 1
  }
  const result = await pairDevice({
    central: opts.central,
    storePath: opts.storePath,
    nowMs: opts.nowMs,
    confirm: opts.confirm,
    select: opts.select,
  })
  if (result.ok) {
    io.log(`Paired ${result.deviceId} as default device.`)
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
}
