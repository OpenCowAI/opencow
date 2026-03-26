// SPDX-License-Identifier: Apache-2.0

/**
 * update/ — GitHub Release update checking subsystem.
 *
 * Module decomposition:
 *   - semver.ts             — Pure semver parsing & comparison
 *   - releaseTypes.ts       — Shared type definitions (ReleaseInfo, ReleaseAsset)
 *   - githubReleaseClient.ts — HTTP client for GitHub Releases API
 *   - assetMatcher.ts       — Platform-aware download asset resolution
 *   - updateCheckerService.ts — Scheduling, state management, DataBus dispatch
 *
 * @module
 */

export { parseSemVer, isNewerVersion } from './semver'
export type { SemVer } from './semver'
export type { ReleaseInfo, ReleaseAsset } from './releaseTypes'
export { fetchLatestRelease } from './githubReleaseClient'
export { findMatchingAssetUrl } from './assetMatcher'
export { UpdateCheckerService } from './updateCheckerService'
export type { UpdateCheckerDeps } from './updateCheckerService'
