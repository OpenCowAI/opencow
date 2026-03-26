// SPDX-License-Identifier: Apache-2.0

/**
 * UpdateCheckerService — Scheduling, state management, and DataBus dispatch
 * for GitHub Release update checks.
 *
 * Responsibilities (Single Responsibility):
 *   - Schedule deferred first check and periodic re-checks
 *   - Coordinate fetch → compare → dispatch pipeline
 *   - De-duplicate notifications (same version not re-announced)
 *   - Integrate with system resume (caller wires powerMonitor)
 *
 * Does NOT contain: semver logic, HTTP client, asset matching.
 * Those are in sibling modules within the `update/` directory.
 *
 * @module
 */

import { createLogger } from '../../platform/logger'
import { APP_VERSION } from '../../../src/shared/appIdentity'
import type { DataBus } from '../../core/dataBus'
import type { UpdateCheckInterval } from '../../../src/shared/types'
import { isNewerVersion } from './semver'
import { fetchLatestRelease } from './githubReleaseClient'
import { findMatchingAssetUrl } from './assetMatcher'
import type { ReleaseInfo } from './releaseTypes'

const log = createLogger('UpdateChecker')

// ─── Interval Mapping ────────────────────────────────────────────────

const INTERVAL_MS: Record<UpdateCheckInterval, number> = {
  '1h': 1 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

/** Delay before the first automatic check (avoids blocking startup). */
const FIRST_CHECK_DELAY_MS = 30_000

// ─── Dependency Interface ────────────────────────────────────────────

export interface UpdateCheckerDeps {
  bus: DataBus
  /** Proxy-aware fetch function (reuses ProxyFetchFactory). */
  getFetch: () => typeof globalThis.fetch
  /** Read current update settings (called at check-time, not cached). */
  getUpdateSettings: () => {
    autoCheckUpdates: boolean
    updateCheckInterval: UpdateCheckInterval
  }
}

// ─── Service ─────────────────────────────────────────────────────────

export class UpdateCheckerService {
  private readonly bus: DataBus
  private readonly getFetch: () => typeof globalThis.fetch
  private readonly getUpdateSettings: UpdateCheckerDeps['getUpdateSettings']
  private timer: ReturnType<typeof setInterval> | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  /** Last successfully detected newer release — prevents duplicate notifications. */
  private lastNotifiedVersion: string | null = null

  constructor(deps: UpdateCheckerDeps) {
    this.bus = deps.bus
    this.getFetch = deps.getFetch
    this.getUpdateSettings = deps.getUpdateSettings
  }

  /**
   * Start the update checker.
   * Performs a deferred first check (30s), then schedules periodic checks.
   */
  start(): void {
    const { autoCheckUpdates } = this.getUpdateSettings()
    if (!autoCheckUpdates) {
      log.info('Auto-update check disabled by user preference')
      return
    }

    // Deferred first check — avoid slowing down startup
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null
      void this.performCheck()
      this.schedulePeriodicCheck()
    }, FIRST_CHECK_DELAY_MS)

    log.info('UpdateChecker started (first check in 30s)')
  }

  /**
   * Perform an immediate update check.
   * Called from IPC (manual "Check for Updates" button).
   * Returns the release info if a newer version is found, null otherwise.
   */
  async checkNow(): Promise<ReleaseInfo | null> {
    return this.performCheck()
  }

  /**
   * Re-check after system resume. Only fires if auto-check is enabled.
   */
  onSystemResume(): void {
    const { autoCheckUpdates } = this.getUpdateSettings()
    if (!autoCheckUpdates) return
    log.info('System resumed — triggering update check')
    void this.performCheck()
  }

  /** Restart the periodic timer (e.g. after settings change). */
  reschedule(): void {
    this.stopPeriodicCheck()
    const { autoCheckUpdates } = this.getUpdateSettings()
    if (autoCheckUpdates) {
      this.schedulePeriodicCheck()
    }
  }

  /** Stop all timers. */
  stop(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    this.stopPeriodicCheck()
    log.info('UpdateChecker stopped')
  }

  // ── Internal ───────────────────────────────────────────────────────

  private async performCheck(): Promise<ReleaseInfo | null> {
    log.debug('Checking for updates...')
    const fetchFn = this.getFetch()
    const release = await fetchLatestRelease(fetchFn)

    const checkedAt = new Date().toISOString()

    if (!release) {
      // Network error or invalid response — report as up-to-date
      // so the UI doesn't get stuck in a "checking" state.
      this.bus.dispatch({
        type: 'update:check-result',
        payload: { status: 'up-to-date', currentVersion: APP_VERSION, checkedAt },
      })
      return null
    }

    if (isNewerVersion(APP_VERSION, release.version)) {
      log.info(`New version available: ${release.version} (current: ${APP_VERSION})`)

      // Only notify if this is a version we haven't already notified about
      if (this.lastNotifiedVersion !== release.version) {
        this.lastNotifiedVersion = release.version

        this.bus.dispatch({
          type: 'update:check-result',
          payload: {
            status: 'available',
            currentVersion: APP_VERSION,
            latestVersion: release.version,
            releaseUrl: release.htmlUrl,
            releaseNotes: release.body,
            publishedAt: release.publishedAt,
            downloadUrl: findMatchingAssetUrl(release.assets),
            checkedAt,
          },
        })
      }

      return release
    }

    log.debug(`Already up to date (current: ${APP_VERSION}, latest: ${release.version})`)
    this.bus.dispatch({
      type: 'update:check-result',
      payload: { status: 'up-to-date', currentVersion: APP_VERSION, checkedAt },
    })
    return null
  }

  private schedulePeriodicCheck(): void {
    this.stopPeriodicCheck()
    const { updateCheckInterval } = this.getUpdateSettings()
    const intervalMs = INTERVAL_MS[updateCheckInterval] ?? INTERVAL_MS['4h']
    this.timer = setInterval(() => {
      void this.performCheck()
    }, intervalMs)
    log.info(`Periodic update check scheduled every ${updateCheckInterval}`)
  }

  private stopPeriodicCheck(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
