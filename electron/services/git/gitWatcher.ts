// SPDX-License-Identifier: Apache-2.0

/**
 * GitWatcher — file system change listener with debounce.
 *
 * Responsibility: watch project files + git internals for changes,
 * debounce rapid events, invoke a callback when changes settle.
 *
 * Design:
 *   - Two-layer watching: workspace files + git internal files (.git/HEAD, .git/index)
 *   - Noise filtering: ignores node_modules, .git/objects, build artifacts
 *   - Self-managed anti-feedback-loop: NO external API needed
 *   - Explicit start/stop lifecycle — no resource leaks
 *   - The callback receives no arguments; the caller decides what to refresh
 *
 * Anti-feedback-loop strategy (fully self-contained):
 *
 *   Each git refresh (triggered by this watcher's callback) runs 4+ git
 *   sub-commands that READ .git/* files. On macOS, FSEvents (recursive
 *   watchers) may report these reads as events, and kqueue (individual
 *   file watchers) may report metadata updates. If these self-triggered
 *   events re-fire the callback, a refresh→event→refresh loop forms.
 *
 *   Three layers of defense, all internal to GitWatcher:
 *
 *     Layer 1 — Mtime validation (primary):
 *       Git internal file watchers (.git/HEAD, .git/index) compare mtime
 *       before scheduling. Git reads don't change mtime → event dropped.
 *
 *     Layer 2 — Non-recursive refs/heads (primary):
 *       The refs/heads watcher uses kqueue (non-recursive) instead of
 *       FSEvents. kqueue only fires on actual writes, not reads.
 *
 *     Layer 3 — Post-callback suppression (defense-in-depth):
 *       After the onChange callback completes, a suppression window
 *       DROPs all events for `postCallbackSuppressMs`. This catches
 *       any residual FS noise not filtered by layers 1-2.
 *       Fully self-managed — the watcher controls its own callback
 *       lifecycle, so no external `suppress()` call is needed.
 *
 * @module gitWatcher
 */

import { watch, statSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { createLogger } from '../../platform/logger'

const log = createLogger('GitWatcher')

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GitWatcherConfig {
  /** Debounce interval for FS events (ms). Default: 300 */
  readonly debounceMs?: number

  /**
   * Post-callback suppression window (ms). Default: 500
   *
   * After the onChange callback completes (success or failure), all FS
   * events are dropped for this duration. This absorbs residual noise
   * from git commands that the callback likely triggered.
   *
   * Set to 0 to disable (useful for testing).
   */
  readonly postCallbackSuppressMs?: number
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Watches a project directory for file changes relevant to git status.
 *
 * Uses Node.js native `fs.watch` (recursive) instead of chokidar to avoid
 * the extra dependency — Electron's bundled Node.js supports recursive
 * watching on macOS (FSEvents) and Windows (ReadDirectoryChangesW).
 *
 * Lifecycle:
 *   - `start()`: begin watching, invoke `onChange` on debounced changes
 *   - `stop()`: release all watchers and timers
 *   - Idempotent: calling `start()` twice stops the previous watcher first
 */
export class GitWatcher {
  private readonly debounceMs: number
  private readonly postCallbackSuppressMs: number
  private workspaceWatcher: FSWatcher | null = null
  private gitInternalWatchers: FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private onChangeCallback: (() => void | Promise<void>) | null = null

  /**
   * Post-callback suppression timestamp.
   *
   * Self-managed: set automatically after each callback completes.
   * Events arriving before this timestamp are dropped (not deferred).
   *
   * Why DROP instead of DEFER:
   *   The previous "defer" design perpetuated the feedback loop — deferred
   *   events fired at the suppression boundary, triggering another refresh,
   *   creating a ~500ms polling cycle. DROP breaks this cycle cleanly.
   *
   * Why self-managed instead of external API:
   *   The watcher controls callback invocation, so it naturally knows when
   *   the callback completes. External `suppress()` calls create temporal
   *   coupling and risk inconsistency (e.g. forceRefresh paths forgetting
   *   to call suppress).
   */
  private suppressUntil = 0

  /**
   * Mtime cache for git internal files.
   *
   * Git commands READ .git/HEAD, .git/index etc. during refresh. On some
   * OS/FS combinations, watchers fire on reads (FSEvents) or metadata
   * updates (kqueue). By tracking the last-known mtime, we only schedule
   * a callback when the file content has actually changed.
   *
   * This is the primary defense against self-triggered events from git
   * internal file watchers. Suppression is secondary defense-in-depth.
   */
  private readonly mtimeCache = new Map<string, number>()

  /**
   * Guards against concurrent callback execution.
   *
   * If the debounce timer fires while a previous async callback is still
   * running, the new invocation is skipped. The in-flight callback's git
   * commands will produce a fresh snapshot anyway, making the queued
   * refresh redundant.
   */
  private callbackInFlight = false

  constructor(config?: GitWatcherConfig) {
    this.debounceMs = config?.debounceMs ?? 300
    this.postCallbackSuppressMs = config?.postCallbackSuppressMs ?? 500
  }

  /**
   * Start watching for file changes.
   *
   * Applies an initial suppression window so that the caller can safely
   * run git commands (e.g. initial refresh) right after `start()` without
   * triggering a redundant watcher-driven refresh from the FS noise.
   *
   * @param projectPath  Project root directory
   * @param gitRoot      Git repository root (may differ from projectPath in monorepos)
   * @param onChange      Callback invoked after changes settle (debounced)
   */
  start(projectPath: string, gitRoot: string, onChange: () => void | Promise<void>): void {
    this.stop() // Idempotent: clean up previous watchers

    this.onChangeCallback = onChange

    // Initial suppression: absorb FS noise from the caller's immediate
    // git commands (e.g. the initial refresh in GitService.activateProject).
    if (this.postCallbackSuppressMs > 0) {
      this.suppressUntil = Date.now() + this.postCallbackSuppressMs
    }

    // 1. Workspace file watcher (recursive)
    try {
      this.workspaceWatcher = watch(
        projectPath,
        { recursive: true },
        (_eventType, filename) => {
          // Guard: fs.watch may fire with null/undefined filename on some
          // OS configurations (e.g. macOS FSEvents root-level events).
          // These carry no path info and are treated as noise.
          if (!filename) return

          // Filter out noise directories
          if (this.shouldIgnore(filename)) return
          this.scheduleCallback()
        },
      )

      this.workspaceWatcher.on('error', (err) => {
        log.error('Workspace watcher error', err)
      })
    } catch (err) {
      log.error('Failed to start workspace watcher', err)
    }

    // 2. Git internal file watchers (non-recursive, specific files)
    //    These detect branch switches (HEAD), staging changes (index),
    //    and merge/rebase state changes.
    //
    //    Each watcher validates mtime before scheduling, preventing
    //    self-triggered events from git commands that READ these files.
    const gitDir = join(gitRoot, '.git')
    const gitInternalPaths = [
      join(gitDir, 'HEAD'),
      join(gitDir, 'index'),
      join(gitDir, 'MERGE_HEAD'),
      join(gitDir, 'REBASE_HEAD'),
    ]

    for (const filePath of gitInternalPaths) {
      try {
        // Seed mtime cache
        this.recordMtime(filePath)

        const watcher = watch(filePath, () => {
          if (this.hasMtimeChanged(filePath)) {
            this.scheduleCallback()
          }
        })
        watcher.on('error', () => {
          // Expected: MERGE_HEAD / REBASE_HEAD may not exist. Silent.
        })
        this.gitInternalWatchers.push(watcher)
      } catch {
        // Expected: file may not exist yet. Silent.
      }
    }

    // 3. Watch refs/heads/ for branch creation/deletion.
    //    Uses NON-recursive watching to avoid FSEvents on macOS.
    //    On macOS, non-recursive fs.watch uses kqueue, which only fires on
    //    actual directory modifications (entry added/removed), not on reads.
    //    Branch creation (e.g. `git branch foo`) creates a file directly in
    //    refs/heads/ or creates a subdirectory, both of which kqueue detects.
    try {
      const refsWatcher = watch(
        join(gitDir, 'refs', 'heads'),
        () => { this.scheduleCallback() },
      )
      refsWatcher.on('error', () => { /* refs/heads may not exist in bare repos */ })
      this.gitInternalWatchers.push(refsWatcher)
    } catch {
      // Silent — directory may not exist
    }

    log.info('Started watching', { projectPath })
  }

  /** Stop all watchers and release resources. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.workspaceWatcher) {
      this.workspaceWatcher.close()
      this.workspaceWatcher = null
    }

    for (const watcher of this.gitInternalWatchers) {
      watcher.close()
    }
    this.gitInternalWatchers = []

    this.suppressUntil = 0
    this.callbackInFlight = false
    this.mtimeCache.clear()
    this.onChangeCallback = null
  }

  // ── Private: event filtering ────────────────────────────

  /** Whether a filename (relative path from watcher) should be ignored. */
  private shouldIgnore(filename: string): boolean {
    // Normalise path separators
    const normalised = filename.replace(/\\/g, '/')

    // Check each path segment against noise directories
    const segments = normalised.split('/')
    for (const seg of segments) {
      if (IGNORE_SEGMENTS.has(seg)) return true
    }

    // Ignore .git internal objects (but we DO watch HEAD, index via dedicated watchers)
    if (normalised.startsWith('.git/')) return true

    return false
  }

  // ── Private: debounce + suppression ─────────────────────

  /**
   * Debounce incoming FS events into a single scheduled `tryFire()`.
   *
   * Events during suppression or while a callback is in-flight are dropped
   * immediately — no timer is created for noise events.
   */
  private scheduleCallback(): void {
    if (Date.now() < this.suppressUntil) return
    if (this.callbackInFlight) return

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.tryFire(), this.debounceMs)
  }

  /**
   * Fire the callback if conditions are met.
   *
   * Conditions checked at fire time (may have changed since scheduling):
   *   - Not in suppression window
   *   - No callback currently in-flight
   */
  private tryFire(): void {
    this.debounceTimer = null

    if (Date.now() < this.suppressUntil) return
    if (this.callbackInFlight) return

    this.invokeCallback()
  }

  /**
   * Invoke the onChange callback with full lifecycle management.
   *
   * Handles both sync and async callbacks. After completion (success or
   * failure), automatically applies the suppression window to absorb
   * any FS noise from the callback's git operations.
   */
  private invokeCallback(): void {
    this.callbackInFlight = true

    const onComplete = (): void => {
      this.callbackInFlight = false
      if (this.postCallbackSuppressMs > 0) {
        this.suppressUntil = Date.now() + this.postCallbackSuppressMs
      }
    }

    try {
      const result = this.onChangeCallback?.()
      if (result instanceof Promise) {
        result.then(onComplete, (err) => {
          log.error('onChange callback failed', err)
          onComplete()
        })
      } else {
        onComplete()
      }
    } catch (err) {
      log.error('onChange callback failed (sync)', err)
      onComplete()
    }
  }

  // ── Private: mtime tracking ─────────────────────────────

  /** Record current mtime for a file path (seed or update). */
  private recordMtime(filePath: string): void {
    try {
      const stat = statSync(filePath)
      this.mtimeCache.set(filePath, stat.mtimeMs)
    } catch {
      // File doesn't exist — remove from cache so next check triggers callback
      this.mtimeCache.delete(filePath)
    }
  }

  /**
   * Check if a file's mtime has changed since last recorded.
   *
   * Returns true if the file has been modified (triggers callback).
   * Returns false if mtime is unchanged (read-only access, noise event).
   * Updates the cache atomically when a change is detected.
   */
  private hasMtimeChanged(filePath: string): boolean {
    try {
      const currentMtime = statSync(filePath).mtimeMs
      const lastMtime = this.mtimeCache.get(filePath)

      if (lastMtime !== undefined && currentMtime === lastMtime) {
        return false // No change — read event or metadata-only noise
      }

      this.mtimeCache.set(filePath, currentMtime)
      return true
    } catch {
      // File was deleted or became inaccessible — treat as a change
      // (e.g. MERGE_HEAD deleted after merge completes)
      const hadEntry = this.mtimeCache.has(filePath)
      this.mtimeCache.delete(filePath)
      return hadEntry
    }
  }
}

/** Directory names to ignore in the workspace watcher. */
const IGNORE_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'coverage',
  '.turbo',
  '.next',
  '.nuxt',
])
