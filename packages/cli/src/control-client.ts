import { existsSync } from 'node:fs'
import { type Socket, createConnection } from 'node:net'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function defaultSocket(): string {
  return process.env.M5CT_SOCKET ?? resolve(homedir(), '.m5stack-coding-toys/daemon.sock')
}

export interface DaemonStatus {
  state: string
  board: string | null
  fw: string | null
  caps: readonly string[]
  device_id: string | null
}

export async function callOnce<T = unknown>(sockPath: string, msg: object): Promise<T> {
  if (!existsSync(sockPath)) throw new Error(`daemon socket not found at ${sockPath}`)
  return new Promise((res, rej) => {
    const c = createConnection(sockPath)
    let buf = ''
    c.on('data', (b: Buffer) => {
      buf += b.toString('utf8')
    })
    c.on('end', () => {
      try {
        res(JSON.parse(buf) as T)
      } catch (e) {
        rej(e as Error)
      }
    })
    c.on('error', rej)
    c.write(`${JSON.stringify(msg)}\n`)
  })
}

export function streamSubscription(sockPath: string, onLine: (e: object) => void): Socket {
  if (!existsSync(sockPath)) throw new Error(`daemon socket not found at ${sockPath}`)
  const c = createConnection(sockPath)
  let buf = ''
  c.on('data', (b: Buffer) => {
    buf += b.toString('utf8')
    let nl = buf.indexOf('\n')
    while (nl !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line) {
        try {
          onLine(JSON.parse(line) as object)
        } catch {
          // skip malformed line
        }
      }
      nl = buf.indexOf('\n')
    }
  })
  c.write(`${JSON.stringify({ op: 'subscribe-state' })}\n`)
  return c
}
