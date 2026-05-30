export interface ManifestFile {
  name: string
  offset: number
  sha256?: string
}

export interface FirmwareManifest {
  board: string
  version: string
  files: ManifestFile[]
}

const HEX_OFFSET = /^0x[0-9a-fA-F]+$/
const SHA256 = /^[0-9a-f]{64}$/

interface RawManifest {
  board?: unknown
  fw_version?: unknown
  files?: unknown
  sha256?: unknown
}

/**
 * Parse a manifest.json produced by firmware/scripts/build-manifest.sh.
 * Hex offset strings become numbers; the sha256 dictionary is merged per file.
 * Throws an Error whose message starts with "invalid manifest" on any problem.
 */
export function parseManifest(raw: string): FirmwareManifest {
  let obj: RawManifest
  try {
    obj = JSON.parse(raw) as RawManifest
  } catch {
    throw new Error('invalid manifest: not valid JSON')
  }
  if (typeof obj.board !== 'string' || obj.board.length === 0) {
    throw new Error('invalid manifest: board must be a non-empty string')
  }
  if (typeof obj.fw_version !== 'string' || obj.fw_version.length === 0) {
    throw new Error('invalid manifest: fw_version must be a non-empty string')
  }
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    throw new Error('invalid manifest: files must be a non-empty array')
  }
  const shaDict: Record<string, unknown> =
    obj.sha256 && typeof obj.sha256 === 'object' ? (obj.sha256 as Record<string, unknown>) : {}

  const files: ManifestFile[] = obj.files.map((f, i) => {
    const entry = f as { path?: unknown; offset?: unknown }
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new Error(`invalid manifest: files[${i}].path must be a non-empty string`)
    }
    if (typeof entry.offset !== 'string' || !HEX_OFFSET.test(entry.offset)) {
      throw new Error(`invalid manifest: files[${i}].offset must be a 0x-prefixed hex string`)
    }
    const sha = shaDict[entry.path]
    if (sha !== undefined && (typeof sha !== 'string' || !SHA256.test(sha))) {
      throw new Error(`invalid manifest: sha256[${entry.path}] must be 64 hex chars`)
    }
    return {
      name: entry.path,
      offset: Number.parseInt(entry.offset, 16),
      ...(typeof sha === 'string' ? { sha256: sha } : {}),
    }
  })

  return { board: obj.board, version: obj.fw_version, files }
}
