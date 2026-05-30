import type { BleAdvertisement, BleCentral } from './types.js'

export class FakeBleCentral implements BleCentral {
  closed = false

  constructor(private readonly advertisements: readonly BleAdvertisement[]) {}

  async scanPairing(_opts: { timeoutMs: number }): Promise<BleAdvertisement[]> {
    return this.advertisements.filter((a) => a.pairing).map((a) => ({ ...a }))
  }

  async close(): Promise<void> {
    this.closed = true
  }
}
