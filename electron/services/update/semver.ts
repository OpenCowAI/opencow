// SPDX-License-Identifier: Apache-2.0

/**
 * semver — Lightweight semantic version parsing and comparison.
 *
 * Zero dependencies. Handles the subset of semver used by GitHub Release tags:
 *   - "0.3.0", "v0.3.0", "v1.2.3-beta.1"
 *   - Pre-release suffixes are stripped for comparison (only major.minor.patch matter)
 *
 * @module
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
}

/** Parse a version string like "0.3.0" or "v0.3.0" into components. */
export function parseSemVer(version: string): SemVer | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

/** Returns true if `remote` is strictly newer than `current`. */
export function isNewerVersion(current: string, remote: string): boolean {
  const cur = parseSemVer(current)
  const rem = parseSemVer(remote)
  if (!cur || !rem) return false

  if (rem.major !== cur.major) return rem.major > cur.major
  if (rem.minor !== cur.minor) return rem.minor > cur.minor
  return rem.patch > cur.patch
}
