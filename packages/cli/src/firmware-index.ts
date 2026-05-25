export interface FirmwareFile {
  name: string
  url: string
  sha256: string
  offset: number
}
export interface FirmwareEntry {
  board: string
  version: string
  files: FirmwareFile[]
}
interface BoardIndex {
  defaultVersion: string
  versions: Record<string, FirmwareEntry>
}

const REL = 'https://github.com/houxiaomu/m5stack-coding-toys/releases/download'

export const FIRMWARE_INDEX: Record<string, BoardIndex> = {
  'cores3-se': {
    defaultVersion: '0.3.0',
    versions: {
      '0.3.0': {
        board: 'cores3-se',
        version: '0.3.0',
        files: [
          {
            name: 'bootloader.bin',
            url: `${REL}/fw-cores3-se-0.3.0/bootloader.bin`,
            sha256: '2a71d69b471e20c2bac7fb469f3c6a807b3ebee780e348e5889db0da849ca363',
            offset: 0x0,
          },
          {
            name: 'partitions.bin',
            url: `${REL}/fw-cores3-se-0.3.0/partitions.bin`,
            sha256: 'bd0f7954aca2ef7d925ee21aaa1f3dc8822d1d6ce5cbbd26a135e5886bfff6ce',
            offset: 0x8000,
          },
          {
            name: 'firmware.bin',
            url: `${REL}/fw-cores3-se-0.3.0/firmware.bin`,
            sha256: '4f170bb80d9c557507939be1ccd5384ff0968fcb61a9ad9014b0014129e13e46',
            offset: 0x10000,
          },
        ],
      },
    },
  },
}

export function resolveFirmware(board: string, version?: string): FirmwareEntry {
  const b = FIRMWARE_INDEX[board]
  if (!b) throw new Error(`unknown board: ${board}`)
  const v = version ?? b.defaultVersion
  const entry = b.versions[v]
  if (!entry) throw new Error(`unknown firmware version ${v} for board ${board}`)
  return entry
}
