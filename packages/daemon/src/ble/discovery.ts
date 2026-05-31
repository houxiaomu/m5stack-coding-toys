import { EventEmitter } from 'node:events'
import type { PairedDevice } from '../device-store.js'
import type { DeviceCandidate, DeviceDiscovery } from '../discovery.js'
import { BLE_PRIORITY } from '../discovery.js'
import { makeLogger } from '../logger.js'
import type { BleAdvertisement, BleCentral } from './types.js'

const log = makeLogger('blediscovery')

export interface BleDiscoveryOpts {
  central: BleCentral
  getDefaultDevice: () => PairedDevice | null
  intervalMs: number
  scanTimeoutMs?: number
}

export class BleDiscovery extends EventEmitter implements DeviceDiscovery {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private inScan = false

  constructor(private readonly opts: BleDiscoveryOpts) {
    super()
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.scan()
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async scan(): Promise<void> {
    if (this.inScan) return
    const device = this.opts.getDefaultDevice()
    if (!device) return
    this.inScan = true
    try {
      const adv = await this.opts.central.scanBound({
        deviceId: device.deviceId,
        timeoutMs: this.opts.scanTimeoutMs ?? 1500,
      })
      if (!adv) return
      this.emit('candidate', bleCandidate(adv))
    } catch (err) {
      log.warn('scan error', { error: (err as Error).message, deviceId: device.deviceId })
    } finally {
      this.inScan = false
    }
  }
}

function bleCandidate(adv: BleAdvertisement): DeviceCandidate {
  return {
    kind: 'ble',
    openKey: adv.peripheralUuid ?? adv.deviceId,
    label: `ble:${adv.deviceId}`,
    priority: BLE_PRIORITY,
    deviceId: adv.deviceId,
    board: adv.board,
    ble: adv,
    lastSeenAt: Date.now(),
  }
}
