export const RUNTIME_NAME = 'm5ct'

export interface RuntimeInfo {
  name: typeof RUNTIME_NAME
  version: string
}

export function runtimeVersion(): string {
  // Injected at bundle time by the m5ct build (esbuild `define`). Falls back to
  // '0.0.0' for unbundled dev runs (tsc output / tests).
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeInfo(): RuntimeInfo {
  return { name: RUNTIME_NAME, version: runtimeVersion() }
}

export function runtimeLabel(name: string = RUNTIME_NAME): string {
  return `${name} ${runtimeVersion()}`
}

export function version(): string {
  return runtimeVersion()
}
