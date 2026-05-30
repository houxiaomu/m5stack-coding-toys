import { type BleCentral, BleUnavailableError } from './types.js'

type DynamicImport = (specifier: string) => Promise<unknown>

const dynamicImport = new Function('specifier', 'return import(specifier)') as DynamicImport

export async function createNobleCentral(): Promise<BleCentral> {
  try {
    await dynamicImport('@abandonware/noble')
  } catch (err) {
    const code = (err as Error & { code?: string }).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new BleUnavailableError('BLE backend is not installed', 'missing_backend')
    }
    throw new BleUnavailableError((err as Error).message, 'unsupported')
  }
  throw new BleUnavailableError('noble BLE backend is not wired yet', 'unsupported')
}
