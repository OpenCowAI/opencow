// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseSemVer, isNewerVersion } from '../../../../electron/services/update/semver'

describe('parseSemVer', () => {
  it('parses a plain version string', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('parses a version string with "v" prefix', () => {
    expect(parseSemVer('v0.3.0')).toEqual({ major: 0, minor: 3, patch: 0 })
  })

  it('strips pre-release suffix after patch', () => {
    expect(parseSemVer('v1.0.0-beta.1')).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  it('handles leading/trailing whitespace', () => {
    expect(parseSemVer('  v2.1.0  ')).toEqual({ major: 2, minor: 1, patch: 0 })
  })

  it('returns null for empty string', () => {
    expect(parseSemVer('')).toBeNull()
  })

  it('returns null for non-version string', () => {
    expect(parseSemVer('not-a-version')).toBeNull()
  })

  it('returns null for incomplete version', () => {
    expect(parseSemVer('1.2')).toBeNull()
  })

  it('handles large version numbers', () => {
    expect(parseSemVer('100.200.300')).toEqual({ major: 100, minor: 200, patch: 300 })
  })
})

describe('isNewerVersion', () => {
  it('detects major version bump', () => {
    expect(isNewerVersion('0.3.0', '1.0.0')).toBe(true)
  })

  it('detects minor version bump', () => {
    expect(isNewerVersion('0.3.0', '0.4.0')).toBe(true)
  })

  it('detects patch version bump', () => {
    expect(isNewerVersion('0.3.0', '0.3.1')).toBe(true)
  })

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false)
  })

  it('returns false when remote is older', () => {
    expect(isNewerVersion('1.0.0', '0.9.0')).toBe(false)
  })

  it('handles "v" prefixes on both sides', () => {
    expect(isNewerVersion('v0.3.0', 'v0.4.0')).toBe(true)
  })

  it('returns false for invalid current version', () => {
    expect(isNewerVersion('invalid', '1.0.0')).toBe(false)
  })

  it('returns false for invalid remote version', () => {
    expect(isNewerVersion('1.0.0', 'invalid')).toBe(false)
  })

  it('returns false when both are invalid', () => {
    expect(isNewerVersion('bad', 'worse')).toBe(false)
  })

  it('correctly compares when minor is higher but major is lower', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(false)
  })

  it('correctly compares when patch is higher but minor is lower', () => {
    expect(isNewerVersion('0.5.0', '0.4.9')).toBe(false)
  })
})
