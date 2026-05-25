import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Transport } from './interface.js'

/**
 * Spawns a subprocess and treats its stdin/stdout as a byte-stream transport.
 * Used for integration tests with tools/fake-firmware.
 */
export class FakeStdioTransport extends EventEmitter implements Transport {
  private proc: ChildProcess | null = null
  private _connected = false

  constructor(private readonly cmd: readonly string[]) {
    super()
  }

  get connected(): boolean {
    return this._connected
  }

  get label(): string {
    return `fake-stdio:${this.cmd.join(' ')}`
  }

  async open(): Promise<void> {
    if (this.proc) return
    const [bin, ...rest] = this.cmd
    if (!bin) throw new Error('FakeStdioTransport: empty cmd')
    this.proc = spawn(bin, rest, { stdio: ['pipe', 'pipe', 'inherit'] })
    this.proc.stdout?.on('data', (chunk: Buffer) => this.emit('data', chunk))
    this.proc.on('exit', () => {
      this._connected = false
      this.emit('close')
    })
    this.proc.on('error', (err) => this.emit('error', err))
    this._connected = true
    this.emit('open')
  }

  async write(bytes: Buffer | string): Promise<void> {
    if (!this.proc?.stdin) throw new Error('FakeStdioTransport not open')
    await new Promise<void>((resolve, reject) => {
      this.proc?.stdin?.write(bytes, (err) => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    if (!this.proc) return
    this.proc.kill()
    this.proc = null
    this._connected = false
  }
}
