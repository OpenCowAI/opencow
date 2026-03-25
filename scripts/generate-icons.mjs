#!/usr/bin/env node

/**
 * generate-icons.mjs
 *
 * Single Source of Truth icon pipeline.
 * Generates ALL icon variants from one source image: resources/logo-source.png
 *
 * Usage:
 *   node scripts/generate-icons.mjs
 *
 * Prerequisites (macOS):
 *   - sips (built-in)
 *   - iconutil (built-in)
 *   - python3 + Pillow (`pip3 install Pillow`)
 *
 * Generated outputs:
 *   resources/icon.icns        — macOS .app bundle icon (full-bleed, no padding)
 *   resources/icon.png         — BrowserWindow icon / dev dock icon (with padding + rounded rect)
 *   resources/icon-dev.icns    — dev build .icns (same as icon.icns; swap for badged version later)
 *   resources/icon-dev.png     — dev build .png  (same as icon.png; swap for badged version later)
 *   resources/tray.png         — menu bar tray icon 22×22 (colored, cropped)
 *   resources/tray@2x.png      — menu bar tray icon 44×44 (colored, cropped, Retina)
 *   src/renderer/assets/app-icon.png — About dialog icon (= icon.png)
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = join(dirname(__filename), '..')
const RESOURCES = join(ROOT, 'resources')
const SOURCE = join(RESOURCES, 'logo-source.png')
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

const rendererAssets = join(ROOT, 'src', 'renderer', 'assets')

// Step 1: Write Python script to temp file and execute
const pyScript = join(TMP, 'gen.py')
writeFileSync(pyScript, `
import sys, os
from PIL import Image, ImageDraw, ImageFilter

src_path = sys.argv[1]
tmp_dir  = sys.argv[2]
res_dir  = sys.argv[3]
renderer_assets = sys.argv[4]

src = Image.open(src_path).convert("RGBA")

# ── Crop to content bounding box ──
def get_bbox(img, threshold=30):
    px = img.load()
    w, h = img.size
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > threshold:
                x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return (x0, y0, x1 + 1, y1 + 1)

bbox = get_bbox(src)
sz = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
cx, cy = (bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2
half = sz // 2
crop = src.crop((max(0, cx-half), max(0, cy-half),
                 min(src.size[0], cx+half), min(src.size[1], cy+half)))
if crop.size[0] != crop.size[1]:
    s = max(crop.size)
    c = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    c.paste(crop, ((s - crop.size[0]) // 2, (s - crop.size[1]) // 2))
    crop = c

CANVAS = 1024
RADIUS = 220

# 1. icon_for_icns.png — Full-bleed (NO padding, NO transparency)
COW_PAD_ICNS = int(CANVAS * 0.14)
icns_icon = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
cow_icns = crop.resize((CANVAS - COW_PAD_ICNS * 2,) * 2, Image.LANCZOS)
icns_icon.paste(cow_icns, (COW_PAD_ICNS, COW_PAD_ICNS), cow_icns)
px = icns_icon.load()
for y in range(CANVAS):
    for x in range(CANVAS):
        r, g, b, a = px[x, y]
        if a < 255:
            px[x, y] = (r, g, b, 255)
icns_icon.save(os.path.join(tmp_dir, "icon_for_icns.png"))
print("  ✓ icon_for_icns.png (full-bleed, 0 transparent pixels)")

# 2. icon.png — With padding + rounded rect + shadow
SHAPE = 824
MARGIN = (CANVAS - SHAPE) // 2
SHAPE_RADIUS = int(RADIUS * SHAPE / CANVAS)
COW_PAD_PNG = int(SHAPE * 0.12)
png_icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [MARGIN, MARGIN + 4, MARGIN + SHAPE, MARGIN + SHAPE + 4],
    radius=SHAPE_RADIUS, fill=(0, 0, 0, 30))
png_icon = Image.alpha_composite(png_icon, shadow.filter(ImageFilter.GaussianBlur(8)))
rect = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
ImageDraw.Draw(rect).rounded_rectangle(
    [MARGIN, MARGIN, MARGIN + SHAPE, MARGIN + SHAPE],
    radius=SHAPE_RADIUS, fill=(255, 255, 255, 255))
png_icon = Image.alpha_composite(png_icon, rect)
cow_png = crop.resize((SHAPE - COW_PAD_PNG * 2,) * 2, Image.LANCZOS)
png_icon.paste(cow_png, (MARGIN + COW_PAD_PNG, MARGIN + COW_PAD_PNG), cow_png)
png_icon.save(os.path.join(res_dir, "icon.png"))
png_icon.save(os.path.join(res_dir, "icon-dev.png"))
png_icon.save(os.path.join(renderer_assets, "app-icon.png"))
print("  ✓ icon.png, icon-dev.png, app-icon.png (with padding)")

# 3. tray.png / tray@2x.png — Colored menu bar icon
TRAY_PADDING_RATIO = 0.15
tray_sz = int(sz * (1 + TRAY_PADDING_RATIO * 2))
tray_canvas = Image.new("RGBA", (tray_sz, tray_sz), (0, 0, 0, 0))
offset = int(tray_sz * TRAY_PADDING_RATIO)
tray_canvas.paste(crop, (offset, offset), crop)
tray_canvas.resize((44, 44), Image.LANCZOS).save(os.path.join(res_dir, "tray@2x.png"))
tray_canvas.resize((22, 22), Image.LANCZOS).save(os.path.join(res_dir, "tray.png"))
print("  ✓ tray.png (22×22), tray@2x.png (44×44)")

print("\\n✅ All icon variants generated")
`)

try {
  const result = execSync(
    `python3 "${pyScript}" "${SOURCE}" "${TMP}" "${RESOURCES}" "${rendererAssets}"`,
    { encoding: 'utf-8' },
  )
  console.log(result)
} catch (e) {
  console.error('❌ Python/Pillow failed. Ensure python3 and Pillow are installed.')
  console.error(e.stderr || e.message)
  process.exit(1)
}

// Step 2: Generate .icns from the full-bleed PNG using macOS native tools
console.log('🔨 Building .icns with sips + iconutil\n')

const iconsetDir = join(TMP, 'icon.iconset')
ensureDir(iconsetDir)

const icnsSrc = join(TMP, 'icon_for_icns.png')
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
copyFileSync(join(RESOURCES, 'icon.icns'), join(RESOURCES, 'icon-dev.icns'))
console.log('  ✓ icon.icns, icon-dev.icns\n')

// Cleanup
cleanDir(TMP)

console.log('✅ Done! All icons generated from single source.\n')
console.log('Files updated:')
console.log('  resources/icon.icns        (macOS bundle — full-bleed, no padding)')
console.log('  resources/icon-dev.icns    (dev macOS bundle)')
console.log('  resources/icon.png         (BrowserWindow / dev dock — with padding)')
console.log('  resources/icon-dev.png     (dev BrowserWindow)')
console.log('  resources/tray.png         (tray 22×22)')
console.log('  resources/tray@2x.png      (tray 44×44 Retina)')
console.log('  src/renderer/assets/app-icon.png (About dialog)')
