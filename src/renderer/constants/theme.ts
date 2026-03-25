// SPDX-License-Identifier: Apache-2.0

/**
 * Renderer-layer theme constants.
 *
 * Eliminates the DRY violation of `THEME_CACHE_KEY = 'opencow-theme'`
 * duplicated across useThemeEffect.ts and useBrowserThemeEffect.ts.
 * The localStorage key used by inline scripts in HTML files
 * (index.html / tray-popover.html / browser-workspace.html)
 * should also stay consistent with this (dual-key fallback strategy).
 */

/** localStorage theme cache key (used to prevent FOUC) */
export const THEME_STORAGE_KEY = 'opencow-theme' as const

/** localStorage key prefix for issue drafts */
export const ISSUE_DRAFT_KEY_PREFIX = 'issue-draft:' as const
