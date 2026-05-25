#!/usr/bin/env bash
set -euo pipefail

# Usage: firmware/scripts/build-manifest.sh [board] [version]
# Copies the latest PlatformIO build outputs into firmware/dist/<board>/
# and writes a manifest.json the daemon's DeviceProfile can consume.

BOARD="${1:-cores3-se}"
VERSION="${2:-0.2.0}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PIO_BUILD="$REPO_ROOT/firmware/.pio/build/$BOARD"
DIST="$REPO_ROOT/firmware/dist/$BOARD"

if [[ ! -d "$PIO_BUILD" ]]; then
  echo "error: pio build dir missing: $PIO_BUILD" >&2
  echo "hint: cd firmware && pio run -e $BOARD" >&2
  exit 1
fi

mkdir -p "$DIST"
cp "$PIO_BUILD/bootloader.bin" "$DIST/bootloader.bin"
cp "$PIO_BUILD/partitions.bin" "$DIST/partitions.bin"
cp "$PIO_BUILD/firmware.bin"   "$DIST/firmware.bin"

sha() { shasum -a 256 "$1" | awk '{print $1}'; }

cat > "$DIST/manifest.json" <<EOF
{
  "board": "$BOARD",
  "fw_version": "$VERSION",
  "chip": "esp32s3",
  "flash_size": "8MB",
  "files": [
    { "path": "bootloader.bin", "offset": "0x0" },
    { "path": "partitions.bin", "offset": "0x8000" },
    { "path": "firmware.bin",   "offset": "0x10000" }
  ],
  "sha256": {
    "bootloader.bin": "$(sha "$DIST/bootloader.bin")",
    "partitions.bin": "$(sha "$DIST/partitions.bin")",
    "firmware.bin":   "$(sha "$DIST/firmware.bin")"
  },
  "built_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "wrote $DIST/manifest.json"
