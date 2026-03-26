// SPDX-License-Identifier: Apache-2.0

/**
 * assetMatcher — Finds the correct download asset for the current platform.
 *
 * Strategy per platform:
 *   - macOS: universal DMG → arch-specific DMG → any DMG → ZIP
 *   - Windows: .exe
 *   - Linux: .AppImage → .deb
 *
 * Returns the direct download URL or null if no match is found.
 *
 * @module
 */

import type { ReleaseAsset } from './releaseTypes'

/**
 * Find the download asset matching the current platform and architecture.
 * Returns the direct download URL, or null if no match is found.
 *
 * @param assets  - Release assets from the GitHub API response.
 * @param platform - OS identifier (defaults to `process.platform`).
 * @param arch     - CPU architecture (defaults to `process.arch`).
 */
export function findMatchingAssetUrl(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  if (platform === 'darwin') {
    // Prefer universal DMG, then architecture-specific DMG, then any DMG, then ZIP
    const universalDmg = assets.find((a) => /universal\.dmg$/i.test(a.name))
    if (universalDmg) return universalDmg.downloadUrl

    const archDmg = assets.find((a) =>
      new RegExp(`${arch}\\.dmg$`, 'i').test(a.name),
    )
    if (archDmg) return archDmg.downloadUrl

    const anyDmg = assets.find((a) => /\.dmg$/i.test(a.name))
    if (anyDmg) return anyDmg.downloadUrl

    const zip = assets.find((a) => /\.zip$/i.test(a.name))
    if (zip) return zip.downloadUrl
  }

  if (platform === 'win32') {
    const exe = assets.find((a) => /\.exe$/i.test(a.name))
    if (exe) return exe.downloadUrl
  }

  if (platform === 'linux') {
    const appImage = assets.find((a) => /\.AppImage$/i.test(a.name))
    if (appImage) return appImage.downloadUrl

    const deb = assets.find((a) => /\.deb$/i.test(a.name))
    if (deb) return deb.downloadUrl
  }

  return null
}
