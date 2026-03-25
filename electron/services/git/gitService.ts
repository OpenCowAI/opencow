// SPDX-License-Identifier: Apache-2.0

/**
 * GitService — orchestration layer for git integration.
 *
 * Responsibility: manage per-project GitRepository + GitWatcher instances,
 * lifecycle (activate/deactivate/shutdown), LRU eviction, and DataBus dispatch.
 *
 * Design:
 *   - Follows OpenCow ServiceDeps pattern (injected dispatch function)
 *   - One GitCommandExecutor shared across all projects (stateless)
 *   - Per-project: GitRepository + GitWatcher instances
 *   - LRU eviction: max 3 concurrent active projects to bound resource usage
 *   - Idempotent: activateProject() on an already-active project is a no-op
 *   - Graceful: non-git projects silently return null (no error, no broken UI)
 *
 * Lifecycle:
 *   - Created in createServices (Phase 0.5)
 *   - activateProject() called when a project is selected in the UI
 *   - deactivateProject() called on project switch/close
 *   - shutdown() called in appShutdown sequence
 *
 * @module gitService
 */

import { createLogger } from '../../platform/logger'
import { GitCommandExecutor } from './gitCommandExecutor'
import { GitRepository } from './gitRepository'
import { GitWatcher } from './gitWatcher'
import type { GitRepositorySnapshot, GitLineDiff } from '@shared/gitTypes'
import type { DataBusEvent } from '@shared/types'

const log = createLogger('GitService')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Dependency injection interface — matches OpenCow service conventions. */
export interface GitServiceDeps {
  readonly dispatch: (event: DataBusEvent) => void
}

/** Internal tracked state for an active project. */
interface ActiveProject {
  readonly repository: GitRepository
  readonly watcher: GitWatcher
  readonly gitRoot: string
  lastAccessed: number
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export class GitService {
  private readonly dispatch: (event: DataBusEvent) => void
  private readonly executor: GitCommandExecutor
  private readonly activeProjects = new Map<string, ActiveProject>()

  /**
   * Dedup concurrent activateProject() calls for the same path.
   *
   * Between the first `await` and `activeProjects.set()`, a second call
   * would pass the idempotency check and create a SECOND Repository + Watcher,
   * leaking the first watcher (never stopped). This Map prevents that.
   */
  private readonly pendingActivations = new Map<string, Promise<GitRepositorySnapshot | null>>()

  /** Maximum concurrently active projects (bounds watcher count). */
  private readonly maxActive = 3

  constructor(deps: GitServiceDeps) {
    this.dispatch = deps.dispatch
    this.executor = new GitCommandExecutor()
  }

  // ── Lifecycle ───────────────────────────────────────────

  /**
   * Activate git integration for a project.
   *
   * - Detects whether it's a git repo
   * - Creates Repository + Watcher
   * - Triggers initial refresh + DataBus dispatch
   * - Idempotent: returns cached snapshot if already active
   *
   * @returns Snapshot if git repo, null if not
   */
  async activateProject(projectPath: string): Promise<GitRepositorySnapshot | null> {
    // Idempotent: already active → refresh access time + return cached
    const existing = this.activeProjects.get(projectPath)
    if (existing) {
      existing.lastAccessed = Date.now()
      return existing.repository.getSnapshot()
    }

    // Dedup concurrent activations: if already activating, piggyback on the same Promise.
    // Without this, two overlapping calls would both pass the idempotency check above
    // (the Map entry doesn't exist until the async work completes), creating two
    // Repository + Watcher pairs — the first watcher leaks forever.
    const pending = this.pendingActivations.get(projectPath)
    if (pending) return pending

    const promise = this.doActivateProject(projectPath)
    this.pendingActivations.set(projectPath, promise)

    return promise.finally(() => {
      this.pendingActivations.delete(projectPath)
    })
  }

  /** Internal activation logic — called exactly once per project activation. */
  private async doActivateProject(projectPath: string): Promise<GitRepositorySnapshot | null> {
    // Check if it's a git repo
    const isRepo = await this.executor.isGitRepo(projectPath)
    if (!isRepo) {
      log.debug('Not a git repo, skipping', { projectPath })
      return null
    }

    // Resolve git root (handles monorepo sub-directories)
    const gitRoot = await this.executor.getRepoRoot(projectPath)
    if (!gitRoot) return null

    // LRU eviction if at capacity
    this.evictIfNeeded()

    // Create Repository + Watcher
    const repository = new GitRepository(projectPath, gitRoot, this.executor)
    const watcher = new GitWatcher()

    // Wire: FS change → repository refresh → DataBus dispatch
    // Anti-feedback-loop protection is fully self-contained in GitWatcher:
    //   - mtime validation on git internal watchers (primary)
    //   - non-recursive refs/heads watcher avoids FSEvents noise (primary)
    //   - post-callback suppression window (defense-in-depth)
    // No manual suppress() call needed here.
    watcher.start(projectPath, gitRoot, async () => {
      try {
        const snapshot = await repository.refresh()
        this.dispatchStatusChanged(projectPath, snapshot)
      } catch (err) {
        log.error('Watcher-triggered refresh failed', { projectPath, err })
      }
    })

    this.activeProjects.set(projectPath, {
      repository,
      watcher,
      gitRoot,
      lastAccessed: Date.now(),
    })

    // Initial refresh — watcher.start() applies an initial suppression
    // window, so the git commands below don't cause a redundant refresh.
    const snapshot = await repository.refresh()
    this.dispatchStatusChanged(projectPath, snapshot)

    log.info('Activated', { projectPath, branch: snapshot.branch, changed: snapshot.changedCount })
    return snapshot
  }

  /**
   * Deactivate git integration for a project.
   *
   * Releases watcher + cache, and notifies renderer to clear stale snapshot.
   */
  deactivateProject(projectPath: string): void {
    const entry = this.activeProjects.get(projectPath)
    if (!entry) return

    entry.watcher.stop()
    this.activeProjects.delete(projectPath)

    // Notify renderer to clear stale snapshot (prevents "ghost" decorations)
    this.dispatchStatusCleared(projectPath)

    log.info('Deactivated', { projectPath })
  }

  /** Global shutdown — called in appShutdown sequence. */
  shutdown(): void {
    for (const [projectPath, entry] of this.activeProjects) {
      entry.watcher.stop()
      log.debug('Shutdown: stopped watcher', { projectPath })
    }
    this.activeProjects.clear()
  }

  // ── Queries ─────────────────────────────────────────────

  /**
   * Force-refresh and broadcast updated snapshot.
   *
   * Called after Agent session idle/stopped (git commands may have run),
   * or on explicit user action.
   */
  async forceRefresh(projectPath: string): Promise<GitRepositorySnapshot | null> {
    const entry = this.activeProjects.get(projectPath)
    if (!entry) return null

    entry.lastAccessed = Date.now()
    const snapshot = await entry.repository.refresh()
    this.dispatchStatusChanged(projectPath, snapshot)
    return snapshot
  }

  /** Get cached snapshot without triggering refresh. */
  async getSnapshot(projectPath: string): Promise<GitRepositorySnapshot | null> {
    const entry = this.activeProjects.get(projectPath)
    if (!entry) return null

    entry.lastAccessed = Date.now()
    return entry.repository.getSnapshot()
  }

  /** Check if a path is a git repository (no activation). */
  async isGitRepo(projectPath: string): Promise<boolean> {
    return this.executor.isGitRepo(projectPath)
  }

  /** Get line-level diff for a single file (for editor gutter). */
  async getFileDiff(projectPath: string, filePath: string): Promise<GitLineDiff[]> {
    const entry = this.activeProjects.get(projectPath)
    if (!entry) return []
    return this.executor.getFileDiff(entry.gitRoot, filePath)
  }

  // ── Private ─────────────────────────────────────────────

  private dispatchStatusChanged(projectPath: string, snapshot: GitRepositorySnapshot): void {
    const event: DataBusEvent = {
      type: 'git:status-changed',
      payload: { projectPath, snapshot },
    }
    this.dispatch(event)
  }

  private dispatchStatusCleared(projectPath: string): void {
    const event: DataBusEvent = {
      type: 'git:status-cleared',
      payload: { projectPath },
    }
    this.dispatch(event)
  }

  /** LRU eviction: deactivate the least-recently-accessed project if at capacity. */
  private evictIfNeeded(): void {
    while (this.activeProjects.size >= this.maxActive) {
      let oldestPath: string | null = null
      let oldestTime = Infinity

      for (const [path, entry] of this.activeProjects) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed
          oldestPath = path
        }
      }

      if (oldestPath) {
        this.deactivateProject(oldestPath)
        log.info('LRU evicted', { path: oldestPath })
      } else {
        break // Safety: shouldn't happen
      }
    }
  }
}
