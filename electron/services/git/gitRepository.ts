// SPDX-License-Identifier: Apache-2.0

/**
 * GitRepository — single-repository state manager.
 *
 * Responsibility: assemble raw git command output into GitRepositorySnapshot,
 * manage cache/staleness, pre-compute directory aggregation, and serialise
 * concurrent refresh requests.
 *
 * Design:
 *   - One instance per active git repository
 *   - Snapshot is immutable — replaced wholesale on each refresh
 *   - Directory aggregation is computed in-process (O(n) once per refresh)
 *   - Concurrent refresh calls share the same in-flight Promise (dedup)
 *   - On error, returns the previous cached snapshot (graceful degradation)
 *
 * @module gitRepository
 */

import { relative, resolve, sep } from 'node:path'
import { createLogger } from '../../platform/logger'
import type { GitCommandExecutor, GitStatusRaw } from './gitCommandExecutor'
import {
  type GitRepositorySnapshot,
  type GitFileState,
  type GitDisplayStatus,
  GitIndexStatus,
  GitWorkTreeStatus,
  GitConflictStatus,
  GitDisplayStatus as DS,
  DIR_STATUS_PRIORITY,
  resolveDisplayStatus,
} from '@shared/gitTypes'

const log = createLogger('GitRepository')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitRepositoryConfig {
  /** Maximum snapshot age before automatic refresh (ms). Default: 5000 */
  readonly maxStalenessMs?: number
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export class GitRepository {
  private readonly maxStaleness: number
  private snapshot: GitRepositorySnapshot | null = null
  private refreshPromise: Promise<GitRepositorySnapshot> | null = null

  constructor(
    private readonly projectPath: string,
    private readonly gitRoot: string,
    private readonly executor: GitCommandExecutor,
    config?: GitRepositoryConfig,
  ) {
    this.maxStaleness = config?.maxStalenessMs ?? 5_000
  }

  /** Get current cached snapshot, refreshing if stale. */
  async getSnapshot(): Promise<GitRepositorySnapshot> {
    if (this.snapshot && !this.isStale()) {
      return this.snapshot
    }
    return this.refresh()
  }

  /**
   * Force-refresh the snapshot.
   *
   * Built-in deduplication: if a refresh is already in-flight, returns
   * the same Promise instead of spawning another git process.
   */
  async refresh(): Promise<GitRepositorySnapshot> {
    if (this.refreshPromise) return this.refreshPromise

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null
    })

    return this.refreshPromise
  }

  /** Clear cached snapshot (e.g. when project path changes). */
  clearCache(): void {
    this.snapshot = null
    this.refreshPromise = null
  }

  // ── Private ─────────────────────────────────────────────

  private isStale(): boolean {
    if (!this.snapshot) return true
    return Date.now() - this.snapshot.timestamp > this.maxStaleness
  }

  private async doRefresh(): Promise<GitRepositorySnapshot> {
    const startMs = Date.now()

    try {
      // Parallel execution of independent git commands
      const [statusRaw, aheadBehind, merging, rebasing] = await Promise.all([
        this.executor.getStatus(this.gitRoot),
        this.executor.getAheadBehind(this.gitRoot),
        this.executor.isMerging(this.gitRoot),
        this.executor.isRebasing(this.gitRoot),
      ])

      const { files, directories, changedCount } = this.buildFileIndex(statusRaw)

      const snapshot: GitRepositorySnapshot = {
        branch: statusRaw.branch,
        isDetached: statusRaw.isDetached,
        upstream: statusRaw.upstream,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        isMerging: merging,
        isRebasing: rebasing,
        files,
        directories,
        changedCount,
        timestamp: Date.now(),
      }

      this.snapshot = snapshot

      log.debug('Refresh completed', {
        branch: snapshot.branch,
        changed: snapshot.changedCount,
        durationMs: Date.now() - startMs,
      })

      return snapshot
    } catch (err) {
      log.error('Refresh failed', err)

      // Graceful degradation: return previous snapshot if available
      if (this.snapshot) return this.snapshot

      // No previous snapshot — return empty
      return this.emptySnapshot()
    }
  }

  /**
   * Build file state index + pre-compute directory aggregation.
   *
   * Single O(n) pass over status entries that simultaneously:
   * 1. Converts porcelain characters to typed GitFileState
   * 2. Propagates display status upward to all ancestor directories
   */
  private buildFileIndex(raw: GitStatusRaw): {
    files: Record<string, GitFileState>
    directories: Record<string, GitDisplayStatus>
    changedCount: number
  } {
    const files: Record<string, GitFileState> = {}
    const dirStatuses = new Map<string, GitDisplayStatus>()

    for (const entry of raw.entries) {
      const state: GitFileState = {
        index: this.toIndexStatus(entry.indexChar),
        workTree: this.toWorkTreeStatus(entry.workTreeChar),
        conflict: this.detectConflict(entry.indexChar, entry.workTreeChar),
      }

      // Convert from git-root-relative → project-relative path
      const projectRelPath = this.gitRootToProjectPath(entry.path)
      if (projectRelPath === null) continue // File is outside project directory (monorepo)

      files[projectRelPath] = state

      // Propagate display status to all ancestor directories
      const display = resolveDisplayStatus(state)
      if (display !== DS.Clean && display !== DS.Ignored) {
        this.propagateToAncestors(projectRelPath, display, dirStatuses)
      }
    }

    return {
      files,
      directories: Object.fromEntries(dirStatuses),
      changedCount: Object.keys(files).length,
    }
  }

  /**
   * Propagate a file's display status upward to all ancestor directories.
   *
   * Each directory keeps the highest-priority status among its descendants.
   * E.g. "src/lib/foo.ts" with Modified → "src/lib" and "src" both get Modified
   * (unless a higher-priority status is already present).
   */
  private propagateToAncestors(
    filePath: string,
    status: GitDisplayStatus,
    dirStatuses: Map<string, GitDisplayStatus>,
  ): void {
    const parts = filePath.split('/')
    // Start from second-to-last segment (last is the filename)
    for (let i = parts.length - 1; i > 0; i--) {
      const dirPath = parts.slice(0, i).join('/')
      const existing = dirStatuses.get(dirPath)

      if (!existing) {
        dirStatuses.set(dirPath, status)
        continue
      }

      // Only upgrade priority, never downgrade
      const existingPrio = DIR_STATUS_PRIORITY.indexOf(existing)
      const newPrio = DIR_STATUS_PRIORITY.indexOf(status)

      if (newPrio >= 0 && (existingPrio < 0 || newPrio < existingPrio)) {
        dirStatuses.set(dirPath, status)
      }

      // Early exit: if already at highest priority (Conflict), all ancestors will be too
      if (existingPrio === 0) break
    }
  }

  // ── Mapping helpers ─────────────────────────────────────

  private toIndexStatus(char: string): GitIndexStatus {
    switch (char) {
      case 'M': return GitIndexStatus.Modified
      case 'A': return GitIndexStatus.Added
      case 'D': return GitIndexStatus.Deleted
      case 'R': return GitIndexStatus.Renamed
      case 'C': return GitIndexStatus.Copied
      default:  return GitIndexStatus.Clean
    }
  }

  private toWorkTreeStatus(char: string): GitWorkTreeStatus {
    switch (char) {
      case 'M': return GitWorkTreeStatus.Modified
      case 'D': return GitWorkTreeStatus.Deleted
      case '?': return GitWorkTreeStatus.Untracked
      case '!': return GitWorkTreeStatus.Ignored
      default:  return GitWorkTreeStatus.Clean
    }
  }

  private detectConflict(indexChar: string, workTreeChar: string): GitConflictStatus {
    const combo = indexChar + workTreeChar
    switch (combo) {
      case 'UU': return GitConflictStatus.BothModified
      case 'AA': return GitConflictStatus.BothAdded
      case 'AU': return GitConflictStatus.AddedByUs
      case 'UA': return GitConflictStatus.AddedByThem
      case 'DU': return GitConflictStatus.DeletedByUs
      case 'UD': return GitConflictStatus.DeletedByThem
      default:   return GitConflictStatus.None
    }
  }

  /**
   * Convert git-root-relative path to project-relative path.
   *
   * Handles monorepo case where gitRoot !== projectPath.
   * Returns null if the file is outside the project directory.
   */
  private gitRootToProjectPath(gitRelativePath: string): string | null {
    const absPath = resolve(this.gitRoot, gitRelativePath)
    const rel = relative(this.projectPath, absPath)

    // Outside project directory (monorepo sibling packages)
    if (rel.startsWith('..')) return null

    // Normalise to forward-slash (cross-platform)
    return rel.split(sep).join('/')
  }

  private emptySnapshot(): GitRepositorySnapshot {
    return {
      branch: null,
      isDetached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      isMerging: false,
      isRebasing: false,
      files: {},
      directories: {},
      changedCount: 0,
      timestamp: Date.now(),
    }
  }
}
