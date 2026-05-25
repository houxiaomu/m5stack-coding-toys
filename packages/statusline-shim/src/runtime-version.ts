export function runtimeVersion(): string {
  return process.env.M5CT_VERSION ?? '0.0.0'
}

export function runtimeLabel(name: string): string {
  return `${name} ${runtimeVersion()}`
}
