#!/bin/bash
# Patch Electron binary's Info.plist so macOS menu bar shows "OpenCow"
# instead of "Electron" during development.
#
# macOS derives the bold menu-bar app name from CFBundleName inside the
# running .app bundle's Info.plist.  In development we run the stock
# Electron binary, whose Info.plist says "Electron".  This script
# overwrites the relevant keys after every `npm install` / `pnpm install`.

set -euo pipefail

APP_NAME="OpenCow"

# Resolve the Electron.app path relative to the project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Try to locate the Electron.app Info.plist
ELECTRON_APP=$(find "$PROJECT_DIR/node_modules" -path "*/electron/dist/Electron.app/Contents/Info.plist" -maxdepth 8 2>/dev/null | head -1)

if [ -z "$ELECTRON_APP" ]; then
  echo "[patch-electron-name] Electron.app not found — skipping."
  exit 0
fi

echo "[patch-electron-name] Patching $ELECTRON_APP ..."
defaults write "${ELECTRON_APP%.plist}" CFBundleName "$APP_NAME"
defaults write "${ELECTRON_APP%.plist}" CFBundleDisplayName "$APP_NAME"

# Also patch the Helper apps so Activity Monitor shows "OpenCow Helper" etc.
HELPERS_DIR="$(dirname "$ELECTRON_APP")/../Frameworks"
if [ -d "$HELPERS_DIR" ]; then
  for helper_plist in "$HELPERS_DIR"/Electron\ Helper*/Contents/Info.plist; do
    if [ -f "$helper_plist" ]; then
      helper_name=$(defaults read "${helper_plist%.plist}" CFBundleName 2>/dev/null || true)
      if [ -n "$helper_name" ]; then
        new_name="${helper_name/Electron/$APP_NAME}"
        defaults write "${helper_plist%.plist}" CFBundleName "$new_name"
        defaults write "${helper_plist%.plist}" CFBundleDisplayName "$new_name"
      fi
    fi
  done
fi

echo "[patch-electron-name] Done — menu bar will show \"$APP_NAME\"."
