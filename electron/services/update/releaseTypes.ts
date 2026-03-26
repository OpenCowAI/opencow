// SPDX-License-Identifier: Apache-2.0

/**
 * releaseTypes — Shared type definitions for the update subsystem.
 *
 * Kept separate from implementation modules to avoid circular imports
 * and to provide a single source of truth for GitHub Release shapes.
 *
 * @module
 */

export interface ReleaseInfo {
  /** Cleaned version string, e.g. "0.4.0" */
  version: string
  /** Original tag name, e.g. "v0.4.0" */
  tagName: string
  /** URL to the GitHub Release page */
  htmlUrl: string
  /** Release notes in Markdown */
  body: string
  /** ISO 8601 publish date */
  publishedAt: string
  /** Download assets attached to the release */
  assets: ReleaseAsset[]
}

export interface ReleaseAsset {
  name: string
  downloadUrl: string
  size: number
  contentType: string
}
