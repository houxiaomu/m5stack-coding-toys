import { readDeviceStore } from '@m5stack-coding-toys/daemon'

interface IO {
  log(line: string): void
  error(line: string): void
}

export interface DevicesRunOpts {
  storePath?: string
  io?: IO
  nowMs?: number
}

const defaultIO: IO = {
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}

export function runDevices(opts: DevicesRunOpts = {}): number {
  const io = opts.io ?? defaultIO
  const store = readDeviceStore(opts.storePath)
  const devices = Object.values(store.devices).sort((a, b) => {
    if (a.deviceId === store.defaultDeviceId) return -1
    if (b.deviceId === store.defaultDeviceId) return 1
    return a.deviceId.localeCompare(b.deviceId)
  })
  if (devices.length === 0) {
    io.log('No paired BLE devices.')
    io.log('')
    io.log('To pair a device:')
    io.log('  m5ct pair')
    return 0
  }
  io.log('Paired devices:')
  io.log('')
  const now = opts.nowMs ?? Date.now()
  for (const d of devices) {
    const marker = d.deviceId === store.defaultDeviceId ? '*' : ' '
    const suffix = d.deviceId === store.defaultDeviceId ? '   default' : ''
    io.log(
      `${marker} ${d.deviceId.padEnd(11)}  ${d.name.padEnd(14)} last seen ${formatAgo(
        now - d.lastSeenAt,
      )}${suffix}`,
    )
  }
  return 0
}

function formatAgo(deltaMs: number): string {
  const min = Math.max(0, Math.floor(deltaMs / 60_000))
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
