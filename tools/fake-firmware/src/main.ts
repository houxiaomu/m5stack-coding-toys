#!/usr/bin/env node
import { CodecError, NdjsonFramer, decode, encode } from '@m5stack-coding-toys/protocol'

const KNOWN_BOARDS = ['cores3-se', 'cardputer-adv'] as const
type Board = (typeof KNOWN_BOARDS)[number]

export function boardId(argv: readonly string[]): Board {
  const idx = argv.indexOf('--board')
  if (idx === -1) return 'cores3-se'
  const value = argv[idx + 1]
  if (!value || !(KNOWN_BOARDS as readonly string[]).includes(value)) {
    throw new Error(`invalid --board: ${value ?? '<missing>'}`)
  }
  return value as Board
}

function capsFor(board: Board): ('display' | 'touch' | 'notify' | 'buttons' | 'haptic')[] {
  return board === 'cores3-se' ? ['display', 'touch', 'notify'] : ['display', 'buttons', 'notify']
}

function deviceId(board: Board): string {
  return `FAKE-${board.toUpperCase()}-${process.pid}`
}

function send(line: string): void {
  process.stdout.write(NdjsonFramer.frame(line))
}

function handle(board: Board, raw: string): void {
  let env: ReturnType<typeof decode>
  try {
    env = decode(raw)
  } catch (err) {
    if (err instanceof CodecError) {
      process.stderr.write(`[fake-firmware] decode error: ${err.message}\n`)
      return
    }
    throw err
  }
  if (env.k === 'hello') {
    // env.p is the cross-kind payload union here; narrow to the time field.
    const time = (env.p as { time?: { utc_ms: number; offset_min: number } }).time
    if (time) {
      console.error(`[fake] rtc sync: utc_ms=${time.utc_ms} offset_min=${time.offset_min}`)
    }
    send(
      encode({
        k: 'hello.ack',
        ...(env.id ? { id: env.id } : {}),
        p: {
          board,
          fw: '0.1.0-fake',
          caps: capsFor(board),
          device_id: deviceId(board),
        },
      }),
    )
    return
  }
  if (env.k === 'ping') {
    send(encode({ k: 'pong', ...(env.id ? { id: env.id } : {}), p: {} }))
    return
  }
  if (env.k === 'notify') {
    if (process.env.M5CT_FAKE_NOTIFY === 'noreply') return
    send(encode({ k: 'notify.ack', ...(env.id ? { id: env.id } : {}), p: {} }))
    return
  }
  if (env.k === 'screenshot') {
    // Emulate the device: reply with a raw 2×2 rgb565 frame (host encodes PNG).
    const data_b64 = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]).toString(
      'base64',
    )
    send(
      encode({
        k: 'screenshot.ack',
        ...(env.id ? { id: env.id } : {}),
        p: { ok: true, w: 2, h: 2, fmt: 'rgb565', data_b64 },
      }),
    )
    return
  }
  if (env.k === 'tap') {
    send(encode({ k: 'tap.ack', ...(env.id ? { id: env.id } : {}), p: { ok: true } }))
    return
  }
  if (env.k === 'status') {
    // Fire-and-forget; log to stderr so tests can scrape the pushed frame.
    process.stderr.write(`[fake-firmware] status ${JSON.stringify(env.p)}\n`)
    return
  }
  process.stderr.write(`[fake-firmware] ignoring ${env.k}\n`)
}

function main(): void {
  const board = boardId(process.argv.slice(2))
  process.stderr.write(`[fake-firmware] board=${board}\n`)
  const framer = new NdjsonFramer()
  process.stdin.on('data', (chunk: Buffer) => {
    for (const line of framer.push(chunk)) {
      handle(board, line)
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
