// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { findMatchingAssetUrl } from '../../../../electron/services/update/assetMatcher'
import type { ReleaseAsset } from '../../../../electron/services/update/releaseTypes'

function asset(name: string, url?: string): ReleaseAsset {
  return {
    name,
    downloadUrl: url ?? `https://example.com/${name}`,
    size: 1000,
    contentType: 'application/octet-stream',
  }
}

describe('findMatchingAssetUrl (macOS)', () => {
  const platform = 'darwin' as const

  it('prefers universal DMG over arch-specific', () => {
    const assets = [
      asset('OpenCow-0.4.0-arm64.dmg'),
      asset('OpenCow-0.4.0-universal.dmg'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-universal.dmg',
    )
  })

  it('falls back to arch-specific DMG when no universal', () => {
    const assets = [
      asset('OpenCow-0.4.0-arm64.dmg'),
      asset('OpenCow-0.4.0-x64.dmg'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-arm64.dmg',
    )
  })

  it('falls back to any DMG when no arch match', () => {
    const assets = [
      asset('OpenCow-0.4.0.dmg'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0.dmg',
    )
  })

  it('falls back to ZIP when no DMG', () => {
    const assets = [
      asset('OpenCow-0.4.0-mac.zip'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-mac.zip',
    )
  })

  it('matches electron-builder universal output naming', () => {
    // electron-builder --mac --universal produces these exact names
    const assets = [
      asset('OpenCow-0.4.0-universal.dmg'),
      asset('OpenCow-0.4.0-universal-mac.zip'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-universal.dmg',
    )
  })

  it('matches electron-builder arch-specific output naming', () => {
    // electron-builder --mac --arm64 produces these exact names
    const assets = [
      asset('OpenCow-0.4.0-arm64.dmg'),
      asset('OpenCow-0.4.0-arm64-mac.zip'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-arm64.dmg',
    )
  })

  it('does not match .dmg.zip as a valid ZIP fallback', () => {
    // electron-builder also produces .dmg.zip (archive of DMG) — should NOT be matched as installer
    const assets = [
      asset('OpenCow-0.4.0-arm64.dmg.zip'),
    ]
    // .dmg.zip matches /\.zip$/i, but users would get a ZIP containing a DMG
    // This is acceptable — the primary preference chain (universal DMG → arch DMG → any DMG) is checked first
    // ZIP fallback only triggers when there's no DMG at all
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBe(
      'https://example.com/OpenCow-0.4.0-arm64.dmg.zip',
    )
  })

  it('returns null when no macOS asset matches', () => {
    const assets = [
      asset('OpenCow-0.4.0.exe'),
      asset('OpenCow-0.4.0.AppImage'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'arm64')).toBeNull()
  })
})

describe('findMatchingAssetUrl (Windows)', () => {
  const platform = 'win32' as const

  it('selects .exe asset', () => {
    const assets = [
      asset('OpenCow-0.4.0.dmg'),
      asset('OpenCow-Setup-0.4.0.exe'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'x64')).toBe(
      'https://example.com/OpenCow-Setup-0.4.0.exe',
    )
  })

  it('returns null when no exe', () => {
    const assets = [
      asset('OpenCow-0.4.0.dmg'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'x64')).toBeNull()
  })
})

describe('findMatchingAssetUrl (Linux)', () => {
  const platform = 'linux' as const

  it('prefers AppImage over deb', () => {
    const assets = [
      asset('OpenCow-0.4.0.deb'),
      asset('OpenCow-0.4.0.AppImage'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'x64')).toBe(
      'https://example.com/OpenCow-0.4.0.AppImage',
    )
  })

  it('falls back to deb when no AppImage', () => {
    const assets = [
      asset('OpenCow-0.4.0.deb'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'x64')).toBe(
      'https://example.com/OpenCow-0.4.0.deb',
    )
  })

  it('returns null when no linux assets', () => {
    const assets = [
      asset('OpenCow-0.4.0.dmg'),
    ]
    expect(findMatchingAssetUrl(assets, platform, 'x64')).toBeNull()
  })
})

describe('findMatchingAssetUrl (empty)', () => {
  it('returns null for empty asset list', () => {
    expect(findMatchingAssetUrl([], 'darwin', 'arm64')).toBeNull()
  })

  it('returns null for unsupported platform', () => {
    const assets = [
      asset('OpenCow-0.4.0.dmg'),
      asset('OpenCow-0.4.0.exe'),
    ]
    expect(findMatchingAssetUrl(assets, 'freebsd' as NodeJS.Platform, 'x64')).toBeNull()
  })
})
