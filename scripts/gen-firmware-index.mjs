// Generate a firmware-index.ts entry from a built firmware manifest.
//
// Reads firmware/dist/<board>/manifest.json, then RECOMPUTES sha256 from the
// actual .bin files on disk (the real safety win — no hand-copied hashes) and
// cross-checks them against the manifest. Prints a ready-to-paste TS object for
// FIRMWARE_INDEX[board].versions[version].
//
// Usage:
//   node scripts/gen-firmware-index.mjs [board]   # default: cores3-se
//
// Exits non-zero if a recomputed hash disagrees with the manifest, or if a
// referenced file is missing.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REL = 'https://github.com/houxiaomu/m5stack-coding-toys/releases/download'

const board = process.argv[2] ?? 'cores3-se'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'firmware', 'dist', board)
const manifestPath = join(distDir, 'manifest.json')

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (err) {
  console.error(`error: cannot read manifest at ${manifestPath}\n  ${err.message}`)
  process.exit(1)
}

const version = manifest.fw_version
if (!version) {
  console.error(`error: manifest has no fw_version: ${manifestPath}`)
  process.exit(1)
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let mismatches = 0
const files = manifest.files.map(({ path, offset }) => {
  const buf = readFileSync(join(distDir, path)) // throws if missing -> non-zero exit
  const actual = sha256(buf)
  const claimed = manifest.sha256?.[path]
  if (claimed && claimed !== actual) {
    console.error(`MISMATCH ${path}\n  manifest: ${claimed}\n  on disk:  ${actual}`)
    mismatches++
  }
  return {
    name: path,
    url: `${REL}/fw-${board}-${version}/${path}`,
    sha256: actual,
    offset: Number(offset),
  }
})

if (mismatches > 0) {
  console.error(`\n${mismatches} hash mismatch(es); not emitting entry.`)
  process.exit(1)
}

// Render a TS literal that matches firmware-index.ts formatting (hex offsets).
const indent = (n) => ' '.repeat(n)
const lines = []
lines.push(`'${version}': {`)
lines.push(`${indent(2)}board: '${board}',`)
lines.push(`${indent(2)}version: '${version}',`)
lines.push(`${indent(2)}files: [`)
for (const f of files) {
  lines.push(`${indent(4)}{`)
  lines.push(`${indent(6)}name: '${f.name}',`)
  lines.push(`${indent(6)}url: \`\${REL}/fw-${board}-${version}/${f.name}\`,`)
  lines.push(`${indent(6)}sha256: '${f.sha256}',`)
  lines.push(`${indent(6)}offset: 0x${f.offset.toString(16)},`)
  lines.push(`${indent(4)}},`)
}
lines.push(`${indent(2)}],`)
lines.push('},')

console.error(`✓ ${board} ${version}: ${files.length} files, hashes verified against disk\n`)
console.log(lines.join('\n'))
