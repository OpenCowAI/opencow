#!/bin/bash
# Rebuild better-sqlite3 native binary for the specified runtime.
#
# Usage:
#   bash scripts/rebuild-better-sqlite3.sh node      # for vitest (Node.js)
#   bash scripts/rebuild-better-sqlite3.sh electron   # for Electron dev
#
# Why: better-sqlite3 ships a single .node binary that must match the
# runtime ABI (Node.js v137 ≠ Electron v143). This script switches
# the binary by re-downloading the correct prebuilt.
#
# Smart skip: reads .forge-meta to detect if the binary already matches
# the target runtime, avoiding redundant rebuilds on every `pnpm dev`.

set -euo pipefail

TARGET="${1:-node}"
PKG_DIR="$(node -e "console.log(require('path').dirname(require.resolve('better-sqlite3/package.json')))")"
META_FILE="$PKG_DIR/build/Release/.forge-meta"
ARCH="$(uname -m | sed 's/x86_64/x64/' | sed 's/aarch64/arm64/')"
NODE_ABI="$(node -e "process.stdout.write(process.versions.modules)")"

# Read the current ABI from .forge-meta (format: "arm64--143")
current_abi() {
  grep -oE '[0-9]+$' "$META_FILE" 2>/dev/null || echo ""
}

# Write .forge-meta with the given ABI (ensures consistent tracking)
write_meta() {
  echo "${ARCH}--${1}" > "$META_FILE"
}

# Determine if a rebuild is needed.
# Strategy: compare current ABI against Node.js ABI.
#   - target=node     → current ABI should equal Node.js ABI
#   - target=electron → current ABI should NOT equal Node.js ABI
needs_rebuild() {
  local abi
  abi="$(current_abi)"
  [ -z "$abi" ] && return 0  # no metadata → rebuild needed

  case "$TARGET" in
    node)     [ "$abi" != "$NODE_ABI" ] ;;
    electron) [ "$abi" = "$NODE_ABI" ] ;;
  esac
}

if ! needs_rebuild; then
  echo "[rebuild] better-sqlite3 already matches $TARGET runtime (ABI=$(current_abi)) — skipping"
  exit 0
fi

echo "[rebuild] Rebuilding better-sqlite3 for $TARGET (current ABI=$(current_abi), Node ABI=$NODE_ABI)..."

case "$TARGET" in
  node)
    cd "$PKG_DIR" && npx --yes prebuild-install
    # prebuild-install doesn't write .forge-meta, so we manage it ourselves
    write_meta "$NODE_ABI"
    ;;
  electron)
    pnpm exec electron-rebuild -f -w better-sqlite3
    # electron-rebuild writes .forge-meta automatically
    ;;
  *)
    echo "Usage: $0 [node|electron]" >&2
    exit 1
    ;;
esac

# Verify the rebuild succeeded
if needs_rebuild; then
  echo "[rebuild] ERROR: ABI still incorrect after rebuild (ABI=$(current_abi))" >&2
  exit 1
fi

echo "[rebuild] Success — ABI=$(current_abi) matches $TARGET runtime"
