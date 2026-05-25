export function version(): string {
  // Injected at bundle time by the m5ct build (esbuild `define`). Falls back to
  // '0.0.0' for un-bundled dev runs (tsc output / tests).
  return process.env.M5CT_VERSION ?? '0.0.0'
}
