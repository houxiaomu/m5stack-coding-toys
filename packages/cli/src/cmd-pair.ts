interface IO {
  log(line: string): void
  error(line: string): void
}

export function runPair(_args: readonly string[], io: IO = console): number {
  io.error('m5ct pair: BLE pairing is not available in this build yet')
  return 1
}
