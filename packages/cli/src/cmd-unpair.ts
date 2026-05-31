import {
  devicesPath,
  readDeviceStore,
  removeDevice,
  resolveDeviceId,
  writeDeviceStore,
} from '@m5stack-coding-toys/daemon'
import { callOnce, defaultSocket } from './control-client.js'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface UnpairRunOpts {
  storePath?: string
  io?: IO
  socket?: string
  controlCall?: <T = unknown>(sockPath: string, msg: object) => Promise<T>
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
    notifyDaemon(opts)
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

function notifyDaemon(opts: UnpairRunOpts): void {
  const sock = opts.socket ?? defaultSocket()
  const control = opts.controlCall ?? callOnce
  void Promise.all([control(sock, { op: 'reloadDevices' }), control(sock, { op: 'rescan' })]).catch(
    () => {},
  )
}
