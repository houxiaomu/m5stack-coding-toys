import {
  devicesPath,
  readDeviceStore,
  removeDevice,
  resolveDeviceId,
  writeDeviceStore,
} from '@m5stack-coding-toys/daemon'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface UnpairRunOpts {
  storePath?: string
  io?: IO
}

const defaultIO: IO = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}

export function runUnpair(args: readonly string[], opts: UnpairRunOpts = {}): number {
  const io = opts.io ?? defaultIO
  const query = args[0]
  if (!query || args.length > 1) {
    io.error('usage: m5ct unpair <device>')
    return 2
  }
  const path = opts.storePath ?? devicesPath()
  const store = readDeviceStore(path)
  try {
    const deviceId = resolveDeviceId(store, query)
    const wasDefault = store.defaultDeviceId === deviceId
    const next = removeDevice(store, deviceId)
    writeDeviceStore(path, next)
    io.log(`Unpaired ${deviceId}.`)
    if (wasDefault) {
      io.log('No default BLE device is set.')
      io.log('')
      io.log('To pair or select a device:')
      io.log('  m5ct pair')
      io.log('  m5ct use <device>')
    }
    return 0
  } catch (err) {
    io.error(`m5ct unpair: ${(err as Error).message}`)
    return 1
  }
}
