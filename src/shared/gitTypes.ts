// SPDX-License-Identifier: Apache-2.0

/**
 * Git integration types — shared between main and renderer processes.
 *
 * Design:
 *   - Semantic layer: GitIndexStatus / GitWorkTreeStatus / GitConflictStatus
 *     map directly to `git status --porcelain=v1` two-column output.
 *   - Display layer: GitDisplayStatus is derived from semantic state via
 *     the pure function `resolveDisplayStatus()`. Never stored in data models.
 *   - Snapshot: GitRepositorySnapshot is the immutable, serialisable payload
 *     pushed from main → renderer via DataBus.
 *
 * Note: Plain enums (not `const enum`) are used intentionally.
 *   Vite/esbuild does not support cross-module `const enum` inlining.
 *   Using plain enums ensures consistent behaviour across all bundlers.
 *
 * @module gitTypes
 */

/* ------------------------------------------------------------------ */
/*  Semantic Layer — git porcelain output                              */
/* ------------------------------------------------------------------ */

/**
 * Index (staging area) status — porcelain column 1.
 *
 * Represents the diff between HEAD and the staging area.
 */
export enum GitIndexStatus {
  Clean    = '',
  Modified = 'M',
  Added    = 'A',
  Deleted  = 'D',
  Renamed  = 'R',
  Copied   = 'C',
}

/**
 * Working tree status — porcelain column 2.
 *
 * Represents the diff between the staging area and the working directory.
 */
export enum GitWorkTreeStatus {
  Clean     = '',
  Modified  = 'M',
  Deleted   = 'D',
  Untracked = '?',
  Ignored   = '!',
}

/**
 * Merge / rebase conflict status.
 *
 * Detected from the two-column combination in porcelain output
 * (e.g. 'UU' = both modified, 'AA' = both added).
 */
export enum GitConflictStatus {
  None          = '',
  BothModified  = 'UU',
  BothAdded     = 'AA',
  AddedByUs     = 'AU',
  AddedByThem   = 'UA',
  DeletedByUs   = 'DU',
  DeletedByThem = 'UD',
}

/**
 * Per-file git state — the raw semantic triple.
 *
 * A single file can have simultaneous index and workTree status
 * (e.g. partially staged: index=Modified, workTree=Modified).
 */
export interface GitFileState {
  readonly index: GitIndexStatus
  readonly workTree: GitWorkTreeStatus
  readonly conflict: GitConflictStatus
}

/* ------------------------------------------------------------------ */
/*  Display Layer — UI presentation                                    */
/* ------------------------------------------------------------------ */

/**
 * Collapsed display status for UI rendering.
 *
 * Derived from GitFileState via `resolveDisplayStatus()`.
 * Not stored in snapshots — always computed on demand.
 */
export enum GitDisplayStatus {
  Clean     = 'clean',
  Modified  = 'modified',
  Staged    = 'staged',
  Partial   = 'partial',
  Untracked = 'untracked',
  Deleted   = 'deleted',
  Renamed   = 'renamed',
  Conflict  = 'conflict',
  Ignored   = 'ignored',
}

/**
 * Resolve semantic GitFileState → UI display status.
 *
 * Priority: Conflict > Partial > Modified/Staged/Untracked/Deleted > Clean.
 *
 * Pure function — safe for both main and renderer processes.
 */
export function resolveDisplayStatus(state: GitFileState): GitDisplayStatus {
  // 1. Conflict takes absolute priority
  if (state.conflict !== GitConflictStatus.None) {
    return GitDisplayStatus.Conflict
  }

  // 2. Untracked
  if (state.workTree === GitWorkTreeStatus.Untracked) {
    return GitDisplayStatus.Untracked
  }

  // 3. Ignored
  if (state.workTree === GitWorkTreeStatus.Ignored) {
    return GitDisplayStatus.Ignored
  }

  const hasIndex = state.index !== GitIndexStatus.Clean
  const hasWorkTree = state.workTree !== GitWorkTreeStatus.Clean

  // 4. Partial staging (both index and workTree have changes)
  if (hasIndex && hasWorkTree) {
    return GitDisplayStatus.Partial
  }

  // 5. Pure staged (only index has changes)
  if (hasIndex) {
    if (state.index === GitIndexStatus.Deleted) return GitDisplayStatus.Deleted
    if (state.index === GitIndexStatus.Renamed) return GitDisplayStatus.Renamed
    return GitDisplayStatus.Staged
  }

  // 6. Pure working tree changes (only workTree has changes)
  if (hasWorkTree) {
    if (state.workTree === GitWorkTreeStatus.Deleted) return GitDisplayStatus.Deleted
    return GitDisplayStatus.Modified
  }

  return GitDisplayStatus.Clean
}

/* ------------------------------------------------------------------ */
/*  Repository Snapshot                                                */
/* ------------------------------------------------------------------ */

/**
 * Immutable snapshot of a git repository's current state.
 *
 * Produced by the main process GitRepository, serialised over IPC/DataBus,
 * consumed by the renderer's GitSlice and decoration functions.
 *
 * Design decisions:
 *   - `files` only contains changed files (clean files omitted → smaller payload).
 *   - `directories` is pre-computed by the main process to avoid O(n) scans
 *     per visible directory node in the renderer.
 *   - All fields are readonly — snapshots are replaced wholesale, never mutated.
 */
export interface GitRepositorySnapshot {
  /** Current branch name (null if detached HEAD) */
  readonly branch: string | null
  /** Whether HEAD is detached */
  readonly isDetached: boolean
  /** Upstream branch name (null if no upstream configured) */
  readonly upstream: string | null
  /** Commits ahead of upstream (0 if no upstream) */
  readonly ahead: number
  /** Commits behind upstream (0 if no upstream) */
  readonly behind: number
  /** Whether a merge is in progress */
  readonly isMerging: boolean
  /** Whether a rebase is in progress */
  readonly isRebasing: boolean
  /**
   * Per-file git status — only files with changes are present.
   * Key: path relative to project root (forward-slash separated).
   */
  readonly files: Readonly<Record<string, GitFileState>>
  /**
   * Pre-computed directory-level aggregated display status.
   * Key: directory path relative to project root.
   * Value: highest-priority display status among all descendants.
   *
   * Computed once in main process per refresh — renderer reads via O(1) lookup.
   */
  readonly directories: Readonly<Record<string, GitDisplayStatus>>
  /** Total number of changed files (for tab badge) */
  readonly changedCount: number
  /** Snapshot generation timestamp (ms) for staleness detection */
  readonly timestamp: number
}

/* ------------------------------------------------------------------ */
/*  Line-level diff (for editor gutter)                                */
/* ------------------------------------------------------------------ */

/** A contiguous range of changed lines in a single file. */
export interface GitLineDiff {
  readonly type: 'added' | 'modified' | 'deleted'
  /** 1-indexed start line in the current file */
  readonly startLine: number
  /** Number of lines affected */
  readonly lineCount: number
}

/* ------------------------------------------------------------------ */
/*  Directory aggregation priority                                     */
/* ------------------------------------------------------------------ */

/**
 * Priority order for directory status aggregation (index 0 = highest).
 *
 * When a directory contains files with multiple statuses, the highest
 * priority status "wins" and is shown on the directory node.
 */
export const DIR_STATUS_PRIORITY: readonly GitDisplayStatus[] = [
  GitDisplayStatus.Conflict,
  GitDisplayStatus.Partial,
  GitDisplayStatus.Modified,
  GitDisplayStatus.Staged,
  GitDisplayStatus.Untracked,
  GitDisplayStatus.Deleted,
  GitDisplayStatus.Renamed,
]
