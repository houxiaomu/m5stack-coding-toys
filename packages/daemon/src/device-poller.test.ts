import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicePoller, type PortInfo } from './device-poller.js'

vi.mock('serialport', () => ({
  SerialPort: { list: vi.fn() },
}))
import { SerialPort } from 'serialport'

describe('DevicePoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('emits attached when an Espressif device appears', async () => {
    const list = SerialPort.list as unknown as ReturnType<typeof vi.fn>
    list.mockResolvedValueOnce([])
    list.mockResolvedValueOnce([
      { path: '/dev/cu.usbmodem1101', vendorId: '303a', productId: '1001', serialNumber: 'ABC' },
    ])
    const poller = new DevicePoller({ vendorIds: ['303a'], intervalMs: 1000 })
    const attached: PortInfo[] = []
    const candidates: unknown[] = []
    poller.on('attached', (i: PortInfo) => attached.push(i))
    poller.on('candidate', (i: unknown) => candidates.push(i))
    poller.start()
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(1100)
    poller.stop()
    expect(attached).toHaveLength(1)
    expect(attached[0]?.path).toBe('/dev/cu.usbmodem1101')
    expect(attached[0]?.vendorId).toBe('303a')
    expect(candidates[0]).toMatchObject({
      kind: 'serial',
      openKey: '/dev/cu.usbmodem1101',
      label: '/dev/cu.usbmodem1101',
      priority: 100,
    })
  })

  it('emits detached when device disappears', async () => {
    const list = SerialPort.list as unknown as ReturnType<typeof vi.fn>
    list.mockResolvedValueOnce([
      { path: '/dev/cu.usbmodem1101', vendorId: '303a', productId: '1001', serialNumber: 'ABC' },
    ])
    list.mockResolvedValueOnce([])
    const poller = new DevicePoller({ vendorIds: ['303a'], intervalMs: 1000 })
    const detached: string[] = []
    poller.on('detached', (i: PortInfo) => detached.push(i.path))
    poller.start()
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(1100)
    poller.stop()
    expect(detached).toEqual(['/dev/cu.usbmodem1101'])
  })

  it('ignores non-matching vendorIds', async () => {
    const list = SerialPort.list as unknown as ReturnType<typeof vi.fn>
    list.mockResolvedValue([{ path: '/dev/cu.unrelated', vendorId: '0403', productId: '6001' }])
    const poller = new DevicePoller({ vendorIds: ['303a'], intervalMs: 1000 })
    const attached: PortInfo[] = []
    poller.on('attached', (i: PortInfo) => attached.push(i))
    poller.start()
    await vi.advanceTimersByTimeAsync(50)
    poller.stop()
    expect(attached).toHaveLength(0)
  })

  it('stop() halts future scans', async () => {
    const list = SerialPort.list as unknown as ReturnType<typeof vi.fn>
    list.mockResolvedValue([])
    const poller = new DevicePoller({ vendorIds: ['303a'], intervalMs: 1000 })
    poller.start()
    poller.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(list.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
