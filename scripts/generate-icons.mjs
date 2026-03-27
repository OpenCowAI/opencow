#!/usr/bin/env node

/**
 * generate-icons.mjs
 *
 * Single Source of Truth icon pipeline.
 * Generates ALL icon variants from source images:
 *   - resources/logo-source.png     → production icons
 *   - resources/logo-source-dev.png → dev build icons (dark background for visual distinction)
 *
 * Usage:
 *   node scripts/generate-icons.mjs
 *
 * Prerequisites (macOS):
 *   - sips (built-in)
 *   - iconutil (built-in)
 *   - python3 + Pillow (`pip3 install Pillow`)
 *
 * Source images (all pre-normalized to 1024×1024):
 *   resources/logo-source.png     — production app icon (white bg, cow at ~64%)
 *   resources/logo-source-dev.png — dev app icon (dark bg, cow at ~64%)
 *   resources/tray-source.png     — tray/menu bar icon (transparent bg, cow at ~75%)
 *
 * Generated outputs:
 *   resources/icon.icns        — macOS .app bundle icon (pre-rendered squircle, works on 11-26+)
 *   resources/icon.png         — BrowserWindow / Dock icon (pre-rendered squircle)
 *   resources/icon-dev.icns    — dev build .icns (pre-rendered squircle, dark bg)
 *   resources/icon-dev.png     — dev Dock icon (pre-rendered squircle, dark bg)
 *   resources/tray.png         — menu bar tray icon 22×22 (colored, cropped)
 *   resources/tray@2x.png      — menu bar tray icon 44×44 (colored, cropped, Retina)
 *
 * Both prod and dev icons go through the SAME pipeline (process_icon).
 * Both .icns and .png use the pre-rendered squircle mask because macOS 11-15
 * does NOT auto-apply squircle to bundle icons. macOS 26+ enforces squircle
 * but our shape already matches, so no double-masking issue.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = join(dirname(__filename), '..')
const RESOURCES = join(ROOT, 'resources')
const SOURCE = join(RESOURCES, 'logo-source.png')
const SOURCE_DEV = join(RESOURCES, 'logo-source-dev.png')
const TMP = join(ROOT, '.tmp-icons')

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd) {
  execSync(cmd, { stdio: 'pipe' })
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function cleanDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

// ── Validation ───────────────────────────────────────────────────────────────

if (!existsSync(SOURCE)) {
  console.error(`❌ Source image not found: ${SOURCE}`)
  console.error('   Place the master logo at resources/logo-source.png')
  process.exit(1)
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('🎨 Generating icon variants from resources/logo-source.png\n')

cleanDir(TMP)
ensureDir(TMP)

// Step 1: Write Python script to temp file and execute
const pyScript = join(TMP, 'gen.py')
writeFileSync(pyScript, `
import sys, os
from PIL import Image, ImageDraw

src_path     = sys.argv[1]
dev_src_path = sys.argv[2]
tmp_dir      = sys.argv[3]
res_dir      = sys.argv[4]

CANVAS = 1024

# ── macOS squircle mask ──
# Apple icon grid: 824×824 squircle centered in 1024×1024 canvas.
SHAPE = 824
MARGIN = (CANVAS - SHAPE) // 2
SHAPE_RADIUS = 185

mask = Image.new("L", (CANVAS, CANVAS), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    [MARGIN, MARGIN, MARGIN + SHAPE, MARGIN + SHAPE],
    radius=SHAPE_RADIUS, fill=255)

def process_icon(source_path, png_name, icns_bleed_name):
    """Identical pipeline for both prod and dev icons.
    Source images are pre-normalized to 1024×1024 with cow at ~64%.

    Both .icns and .png get the pre-rendered squircle mask because:
    - macOS 11-15: system does NOT auto-apply squircle to .icns bundle icons
    - macOS 26+:   system enforces squircle, but our shape already matches
    - Electron:    app.dock.setIcon() and BrowserWindow never get system mask
    """
    src = Image.open(source_path).convert("RGBA")
    if src.size != (CANVAS, CANVAS):
        src = src.resize((CANVAS, CANVAS), Image.LANCZOS)

    # Flatten alpha onto opaque background to eliminate semi-transparent pixels
    bg_px = src.getpixel((0, 0))[:3] + (255,)
    bg = Image.new("RGBA", (CANVAS, CANVAS), bg_px)
    src = Image.alpha_composite(bg, src)

    # Apply squircle mask — used for BOTH .png and .icns
    masked = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    masked.paste(src, (0, 0), mask)

    # .png for Electron (app.dock.setIcon / BrowserWindow)
    masked.save(os.path.join(res_dir, png_name))

    # .icns source: same squircle-masked image (compatible with macOS 11-26+)
    masked.save(os.path.join(tmp_dir, icns_bleed_name))

# Both icons go through the exact same pipeline
process_icon(src_path, "icon.png", "icon-full-bleed.png")
print("  ✓ icon.png (squircle-masked, from logo-source.png)")

if os.path.exists(dev_src_path):
    process_icon(dev_src_path, "icon-dev.png", "icon-dev-full-bleed.png")
    print("  ✓ icon-dev.png (squircle-masked, from logo-source-dev.png)")
else:
    # Fallback: copy production icon
    import shutil
    shutil.copy2(os.path.join(res_dir, "icon.png"), os.path.join(res_dir, "icon-dev.png"))
    shutil.copy2(os.path.join(tmp_dir, "icon-full-bleed.png"), os.path.join(tmp_dir, "icon-dev-full-bleed.png"))
    print("  ✓ icon-dev.png (fallback: same as icon.png)")

# Tray icons — from pre-cleaned tray-source.png (transparent bg, cow at 75%)
tray_src_path = os.path.join(res_dir, "tray-source.png")
if os.path.exists(tray_src_path):
    tray_src = Image.open(tray_src_path).convert("RGBA")
    tray_src.resize((44, 44), Image.LANCZOS).save(os.path.join(res_dir, "tray@2x.png"))
    tray_src.resize((22, 22), Image.LANCZOS).save(os.path.join(res_dir, "tray.png"))
else:
    print("  ⚠ tray-source.png not found, skipping tray icons")
print("  ✓ tray.png (22×22), tray@2x.png (44×44)")

print("\\n✅ All icon variants generated")
`)

try {
  const result = execSync(
    `python3 "${pyScript}" "${SOURCE}" "${SOURCE_DEV}" "${TMP}" "${RESOURCES}"`,
    { encoding: 'utf-8' },
  )
  console.log(result)
} catch (e) {
  console.error('❌ Python/Pillow failed. Ensure python3 and Pillow are installed.')
  console.error(e.stderr || e.message)
  process.exit(1)
}

// Step 2: Generate .icns from icon.png (full-bleed) using macOS native tools
console.log('🔨 Building .icns with sips + iconutil\n')

const iconsetDir = join(TMP, 'icon.iconset')
ensureDir(iconsetDir)

// Use the full-bleed intermediate (not the masked .png) as the .icns source.
// macOS 11+ automatically applies a squircle mask and drop shadow to bundle icons.
const icnsSrc = join(TMP, 'icon-full-bleed.png')
const sizes = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

for (const [name, size] of sizes) {
  run(`sips -z ${size} ${size} "${icnsSrc}" --out "${join(iconsetDir, name)}"`)
}
console.log('  ✓ iconset created (10 sizes)')

run(`iconutil -c icns "${iconsetDir}" -o "${join(RESOURCES, 'icon.icns')}"`)
console.log('  ✓ icon.icns')

// Build icon-dev.icns from icon-dev.png (separate source, dark background)
const devIconsetDir = join(TMP, 'icon-dev.iconset')
ensureDir(devIconsetDir)
const icnsDevSrc = join(TMP, 'icon-dev-full-bleed.png')

for (const [name, size] of sizes) {
  run(`sips -z ${size} ${size} "${icnsDevSrc}" --out "${join(devIconsetDir, name)}"`)
}
run(`iconutil -c icns "${devIconsetDir}" -o "${join(RESOURCES, 'icon-dev.icns')}"`)
console.log('  ✓ icon-dev.icns\n')

// Cleanup
cleanDir(TMP)

console.log('✅ Done! All icons generated from single source.\n')
console.log('Files updated:')
console.log('  resources/icon.icns        (macOS bundle — full-bleed, system applies mask)')
console.log('  resources/icon-dev.icns    (dev macOS bundle, dark bg)')
console.log('  resources/icon.png         (squircle-masked, white bg)')
console.log('  resources/icon-dev.png     (squircle-masked, dark bg)')
console.log('  resources/tray.png         (tray 22×22)')
console.log('  resources/tray@2x.png      (tray 44×44 Retina)')
