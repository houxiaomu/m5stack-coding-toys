/**
 * NDJSON line framer. Buffers byte/string chunks and emits complete lines
 * (without the trailing `\n`). Empty lines are skipped.
 */
export class NdjsonFramer {
  private buffer = ''
  private readonly decoder = new TextDecoder('utf-8', { fatal: false })

  push(chunk: string | Uint8Array): string[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    this.buffer += text
    const lines: string[] = []
    let nl = this.buffer.indexOf('\n')
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (line.length > 0) lines.push(line)
      nl = this.buffer.indexOf('\n')
    }
    return lines
  }

  /** Wrap a single message with a trailing newline. Disallows embedded newlines. */
  static frame(message: string): string {
    if (message.includes('\n')) {
      throw new Error('NDJSON frame may not contain newline characters')
    }
    return `${message}\n`
  }
}
