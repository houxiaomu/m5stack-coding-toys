import type { EventEmitter } from 'node:events'

/**
 * Transport is the byte-stream pipe to a device. Higher layers add framing
 * (NDJSON via @m5stack-coding-toys/protocol's NdjsonFramer) and protocol
 * semantics. A Transport emits 'data' (Buffer), 'open', 'close', 'error'.
 */
export interface Transport extends EventEmitter {
  open(): Promise<void>
  write(bytes: Buffer | string): Promise<void>
  close(): Promise<void>
  readonly connected: boolean
  readonly label: string
}
