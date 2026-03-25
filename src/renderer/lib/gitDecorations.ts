// SPDX-License-Identifier: Apache-2.0

/**
 * Git file decorations — pure functions mapping git state to visual properties.
 *
 * Design:
 *   - FileDecoration is a generic visual protocol, not git-specific.
 *     Future decoration sources (lint errors, agent-editing indicators) can
 *     use the same interface without changing components.
 *   - All lookups are O(1) — components call getFileDecoration(snapshot, path).
 *   - Zero dependencies on React or store — safe for use anywhere.
 *   - Path normalisation is applied internally — callers don't need to worry
 *     about OS-specific separators.
 *
 * @module gitDecorations
 */

import {
  type GitRepositorySnapshot,
  type GitDisplayStatus,
  GitDisplayStatus as DS,
  resolveDisplayStatus,
} from '@shared/gitTypes'

/* ------------------------------------------------------------------ */
/*  FileDecoration — generic visual protocol                           */
/* ------------------------------------------------------------------ */

/** Visual decoration for a single file or directory. */
export interface FileDecoration {
  /** Single-character badge shown to the right of the filename (e.g. 'M', 'U', 'D') */
  readonly badge: string | null
  /** CSS class name for text coloring */
  readonly colorClass: string | null
  /** Tooltip text on hover */
  readonly tooltip: string | null
}

/** Sentinel: no decoration (clean files or git unavailable). */
export const EMPTY_DECORATION: FileDecoration = {
  badge: null,
  colorClass: null,
  tooltip: null,
}

/* ------------------------------------------------------------------ */
/*  Decoration mapping table                                           */
/* ------------------------------------------------------------------ */

const GIT_DECORATION_MAP: Readonly<Record<GitDisplayStatus, FileDecoration>> = {
  [DS.Clean]:     EMPTY_DECORATION,
  [DS.Modified]:  { badge: 'M', colorClass: 'text-git-modified',  tooltip: 'Modified (unstaged)' },
  [DS.Staged]:    { badge: 'S', colorClass: 'text-git-staged',    tooltip: 'Staged' },
  [DS.Partial]:   { badge: 'M', colorClass: 'text-git-partial',   tooltip: 'Partially staged' },
  [DS.Untracked]: { badge: 'U', colorClass: 'text-git-untracked', tooltip: 'Untracked' },
  [DS.Deleted]:   { badge: 'D', colorClass: 'text-git-deleted',   tooltip: 'Deleted' },
  [DS.Renamed]:   { badge: 'R', colorClass: 'text-git-renamed',   tooltip: 'Renamed' },
  [DS.Conflict]:  { badge: '!', colorClass: 'text-git-conflict',  tooltip: 'Merge conflict' },
  [DS.Ignored]:   { badge: null, colorClass: 'text-git-ignored opacity-50', tooltip: 'Ignored' },
}

/* ------------------------------------------------------------------ */
/*  Path normalisation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Normalise a file/directory path to forward-slash format.
 *
 * Git snapshot keys always use forward slashes (normalised in the main process).
 * On Windows, `path.relative()` returns backslashes, so the renderer must
 * normalise before lookup. On macOS/Linux this is a no-op (no backslashes).
 */
function normalisePath(p: string): string {
  return p.includes('\\') ? p.replace(/\\/g, '/') : p
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Get decoration for a file path. O(1) lookup.
 *
 * Components call this instead of directly accessing snapshot.files.
 */
export function getFileDecoration(
  snapshot: GitRepositorySnapshot | undefined,
  filePath: string,
): FileDecoration {
  if (!snapshot) return EMPTY_DECORATION
  const key = normalisePath(filePath)
  const state = snapshot.files[key]
  if (!state) return EMPTY_DECORATION
  const display = resolveDisplayStatus(state)
  return GIT_DECORATION_MAP[display] ?? EMPTY_DECORATION
}

/**
 * Get decoration for a directory path. O(1) lookup into pre-computed map.
 *
 * Directory status is aggregated in the main process — renderer does zero work.
 */
export function getDirDecoration(
  snapshot: GitRepositorySnapshot | undefined,
  dirPath: string,
): FileDecoration {
  if (!snapshot) return EMPTY_DECORATION
  const key = normalisePath(dirPath)
  const display = snapshot.directories[key]
  if (!display) return EMPTY_DECORATION
  return GIT_DECORATION_MAP[display] ?? EMPTY_DECORATION
}
