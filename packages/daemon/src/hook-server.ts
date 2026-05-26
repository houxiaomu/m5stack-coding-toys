import { existsSync, unlinkSync } from 'node:fs'
import { type Server, type Socket, createServer } from 'node:net'
import type { ControlHandler } from './control-ops.js'
import { makeLogger } from './logger.js'

const log = makeLogger('hookserver')

/**
 * Newline-delimited JSON over UNIX domain socket.
 *
 * Two message families share the socket:
 *   1. statusLine frame {statusLine: <CC JSON>} — one-shot; forwarded to the
 *      registered handler, then sock.end('{"ok":true}\n').
 *   2. Control op {op, ...} — one-shot for status/flashHold/flashRelease;
 *      long-lived for subscribe-state (caller keeps reading lines).
 */
export class HookServer {
  private server: Server | null = null
  private control: ControlHandler | null = null
  private onStatusLine:
    | ((cc: Record<string, unknown>, meta: { ccPid?: number; sessionId?: string }) => void)
    | null = null
  private onActivity: (() => void) | null = null
  private onHookEvent: ((event: string) => void) | null = null

  constructor(private readonly socketPath: string) {}

  setActivityHandler(fn: () => void): void {
    this.onActivity = fn
  }

  setHookEventHandler(fn: (event: string) => void): void {
    this.onHookEvent = fn
  }

  setControl(c: ControlHandler): void {
    this.control = c
  }

  setStatusLineHandler(
    fn: (cc: Record<string, unknown>, meta: { ccPid?: number; sessionId?: string }) => void,
  ): void {
    this.onStatusLine = fn
  }

  async listen(): Promise<void> {
    if (existsSync(this.socketPath)) {
      log.debug('removing stale socket', { path: this.socketPath })
      unlinkSync(this.socketPath)
    }
    return new Promise((resolve, reject) => {
      this.server = createServer((sock) => this.handle(sock))
      this.server.on('error', reject)
      this.server.listen(this.socketPath, () => {
        log.info('listening', { socket: this.socketPath })
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    if (!this.server) return
    const s = this.server
    this.server = null
    await new Promise<void>((r) => s.close(() => r()))
    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {
        // racy cleanup is fine
      }
    }
  }

  private handle(sock: Socket): void {
    log.debug('client connected')
    let buf = ''
    sock.on('data', (chunk: Buffer) => {
      this.onActivity?.()
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      void this.process(line, sock)
    })
    sock.on('error', (err) => {
      log.warn('client socket error', { message: err.message })
      sock.destroy()
    })
  }

  private async process(line: string, sock: Socket): Promise<void> {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch (err) {
      log.warn('unparseable', { line, error: (err as Error).message })
      sock.end()
      return
    }
    const sl = (msg as { statusLine?: unknown }).statusLine
    if (sl && typeof sl === 'object') {
      const ccPid = (msg as { ccPid?: unknown }).ccPid
      const sessionId = (msg as { sessionId?: unknown }).sessionId
      this.onStatusLine?.(sl as Record<string, unknown>, {
        ccPid: typeof ccPid === 'number' ? ccPid : undefined,
        sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      })
      sock.end(`${JSON.stringify({ ok: true })}\n`)
      return
    }
    const ev = (msg as { event?: unknown }).event
    if (typeof ev === 'string') {
      this.onHookEvent?.(ev)
      sock.end(`${JSON.stringify({ ok: true })}\n`)
      return
    }
    const op = (msg as { op?: string }).op
    if (op) {
      await this.dispatchOp(op, msg as Record<string, unknown>, sock)
      return
    }
    log.warn('unknown message', { line })
    sock.end(`${JSON.stringify({ error: 'unknown_message' })}\n`)
  }

  private async dispatchOp(op: string, msg: Record<string, unknown>, sock: Socket): Promise<void> {
    if (!this.control) {
      sock.end(`${JSON.stringify({ error: 'control_not_attached' })}\n`)
      return
    }
    const client = typeof msg.client === 'string' ? msg.client : 'unknown'
    try {
      switch (op) {
        case 'status': {
          const r = await this.control.status()
          sock.end(`${JSON.stringify(r)}\n`)
          return
        }
        case 'subscribe-state': {
          this.control.subscribeState(sock)
          return
        }
        case 'flashHold': {
          const r = await this.control.flashHold(client)
          sock.end(`${JSON.stringify(r)}\n`)
          return
        }
        case 'flashRelease': {
          const r = await this.control.flashRelease(client)
          sock.end(`${JSON.stringify(r)}\n`)
          return
        }
        case 'screenshot': {
          const out = typeof msg.out === 'string' ? msg.out : undefined
          const r = await this.control.screenshot(out)
          sock.end(`${JSON.stringify(r)}\n`)
          return
        }
        default:
          sock.end(`${JSON.stringify({ error: `unknown_op: ${op}` })}\n`)
      }
    } catch (err) {
      log.error('op threw', { op, error: (err as Error).message })
      sock.end(`${JSON.stringify({ error: (err as Error).message })}\n`)
    }
  }
}
