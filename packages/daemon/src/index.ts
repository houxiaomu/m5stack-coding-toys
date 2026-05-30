export {
  RUNTIME_NAME,
  runtimeInfo,
  runtimeLabel,
  runtimeVersion,
  version,
  type RuntimeInfo,
} from './version.js'
export { defaultConfig, loadConfig, type DaemonConfig, type TransportConfig } from './config.js'
export { stateDir, socketPath, configPath, pidPath, logPath, devicesPath } from './state-dir.js'
export {
  addOrUpdateDevice,
  emptyDeviceStore,
  readDeviceStore,
  removeDevice,
  resolveDeviceId,
  setDefaultDevice,
  writeDeviceStore,
  type DeviceStoreData,
  type PairedDevice,
} from './device-store.js'
export { FakeBleCentral } from './ble/fake.js'
export { createNobleCentral } from './ble/backend-noble.js'
export { pairDevice, type PairDeviceOpts } from './ble/pairing.js'
export type { BleAdvertisement, BleCentral, BleLink, PairDeviceResult } from './ble/types.js'
export { DeviceSession, type DeviceInfo, type SessionConfig } from './device-session.js'
export { BleTransport } from './transport/ble.js'
export { Router } from './router.js'
export { HookServer } from './hook-server.js'
export type { Transport } from './transport/interface.js'
export { FakeStdioTransport } from './transport/fake-stdio.js'
