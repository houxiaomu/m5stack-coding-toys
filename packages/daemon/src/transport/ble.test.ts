import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { BleTransport } from './ble.js'

class MemoryBleLink extends EventEmitter {
  writes: Buffer[] = []
  closed = false
  label = 'ble:M5SE-A1B2C3'

  async write(bytes: Buffer): Promise<void> {
    this.writes.push(Buffer.from(bytes))
  }

  onData(fn: (bytes: Buffer) => void): void {
    this.on('data', fn)
  }

  onClose(fn: () => void): void {
    this.on('close', fn)
  }

  async close(): Promise<void> {
    this.closed = true
    this.emit('close')
  }
}

describe('BleTransport', () => {
  it('chunks outgoing writes to the configured BLE payload size', async () => {
    const link = new MemoryBleLink()
    const t = new BleTransport(link, { chunkSize: 4 })
    await t.open()
    await t.write(Buffer.from('abcdefghij'))
    expect(link.writes.map((b) => b.toString('utf8'))).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('emits incoming BLE chunks as transport data', async () => {
    const link = new MemoryBleLink()
    const t = new BleTransport(link, { chunkSize: 4 })
    const seen: string[] = []
    t.on('data', (b: Buffer) => seen.push(b.toString('utf8')))
    await t.open()
    link.emit('data', Buffer.from('hello'))
    expect(seen).toEqual(['hello'])
  })

  it('closes the BLE link and marks the transport disconnected', async () => {
    const link = new MemoryBleLink()
    const t = new BleTransport(link)
    await t.open()
    expect(t.connected).toBe(true)
    await t.close()
    expect(link.closed).toBe(true)
    expect(t.connected).toBe(false)
  })
})
