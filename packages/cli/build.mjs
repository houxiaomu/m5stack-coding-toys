import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['serialport', '@abandonware/noble'],
  // Stamp the published version into the bundle so the daemon's version() (used
  // by the singleton lock to decide same-version vs upgrade) reports the truth.
  define: { 'process.env.M5CT_VERSION': JSON.stringify(pkg.version) },
  // No banner needed: all three entry files already carry #!/usr/bin/env node,
  // and esbuild propagates the entry shebang to the top of the bundle.
  // Adding a banner would produce a double-shebang which ESM rejects.
}

await Promise.all([
  build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/m5ct.js' }),
  build({ ...common, entryPoints: ['../daemon/src/main.ts'], outfile: 'dist/m5ctd.js' }),
  build({
    ...common,
    entryPoints: ['../statusline-shim/src/main.ts'],
    outfile: 'dist/m5ct-statusline.js',
  }),
])
console.log('built m5ct, m5ctd, m5ct-statusline')
