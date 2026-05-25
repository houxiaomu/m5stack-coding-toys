import { describe, expect, it } from 'vitest'
import { FakeStdioTransport } from './fake-stdio.js'

describe('FakeStdioTransport', () => {
  it('opens a node subprocess and echoes stdout', async () => {
    const t = new FakeStdioTransport([
      process.execPath,
      '-e',
      'process.stdin.on("data", c => process.stdout.write(c));',
    ])
    const received: string[] = []
    t.on('data', (b: Buffer) => received.push(b.toString('utf8')))
    await t.open()
    expect(t.connected).toBe(true)
    await t.write('hello\n')
    await new Promise((r) => setTimeout(r, 500))
    expect(received.join('')).toContain('hello')
    await t.close()
  }, 5000)

  it('emits close when subprocess exits', async () => {
    const t = new FakeStdioTransport([process.execPath, '-e', 'process.exit(0)'])
    const closed = new Promise<void>((r) => t.once('close', () => r()))
    await t.open()
    await closed
    expect(t.connected).toBe(false)
  }, 5000)
})
