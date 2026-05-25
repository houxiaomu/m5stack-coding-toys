export const RUNTIME_NAME = 'm5ct'

export interface RuntimeInfo {
  name: typeof RUNTIME_NAME
  version: string
}

export function runtimeVersion(): string {
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeInfo(): RuntimeInfo {
  return { name: RUNTIME_NAME, version: runtimeVersion() }
}

export function runtimeLabel(name: string = RUNTIME_NAME): string {
  return `${name} ${runtimeVersion()}`
}
