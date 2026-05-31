import {
  devicesPath,
  readDeviceStore,
  resolveDeviceId,
  setDefaultDevice,
  writeDeviceStore,
} from '@m5stack-coding-toys/daemon'
import { callOnce, defaultSocket } from './control-client.js'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface UseRunOpts {
  storePath?: string
  io?: IO
  socket?: string
  controlCall?: <T = unknown>(sockPath: string, msg: object) => Promise<T>
}

const defaultIO: IO = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}

export function runUse(args: readonly string[], opts: UseRunOpts = {}): number {
  const io = opts.io ?? defaultIO
  const query = args[0]
  if (!query || args.length > 1) {
    io.error('usage: m5ct use <device>')
    return 2
  }
  const path = opts.storePath ?? devicesPath()
  const store = readDeviceStore(path)
  try {
    const deviceId = resolveDeviceId(store, query)
    writeDeviceStore(path, setDefaultDevice(store, deviceId))
    io.log(`Default device set to ${deviceId}.`)
    notifyDaemon(opts)
    return 0
  } catch (err) {
    io.error(`m5ct use: ${(err as Error).message}`)
    return 1
  }
}

function notifyDaemon(opts: UseRunOpts): void {
  const sock = opts.socket ?? defaultSocket()
  const control = opts.controlCall ?? callOnce
  void Promise.all([control(sock, { op: 'reloadDevices' }), control(sock, { op: 'rescan' })]).catch(
    () => {},
  )
}
