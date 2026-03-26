// SPDX-License-Identifier: Apache-2.0

/**
 * updateStore — Manages update notification state in the renderer.
 *
 * Populated by:
 *   - DataBus `update:check-result` events in useAppBootstrap
 *   - Manual "Check for Updates" IPC calls from About dialog / Settings
 *
 * Consumed by:
 *   - UpdateBanner (global notification)
 *   - AboutDialog (version status section)
 *   - SettingsModal UpdateSection (preferences + manual check)
 */

import { create } from 'zustand'
import { getAppAPI } from '@/windowAPI'

// ─── Store Interface ──────────────────────────────────────────────────

export interface UpdateStore {
  /** Whether a newer version is available on GitHub Releases. */
  updateAvailable: boolean
  /** The latest version string (e.g. "0.4.0"), null if not checked yet. */
  latestVersion: string | null
  /** URL to the GitHub Release page. */
  releaseUrl: string | null
  /** Release notes in Markdown. */
  releaseNotes: string | null
  /** Direct download URL for the current platform's installer. */
  downloadUrl: string | null
  /** ISO 8601 publish date of the release. */
  publishedAt: string | null
  /** Version the user dismissed (won't show banner for this version). */
  dismissedVersion: string | null
  /** ISO 8601 timestamp of the last successful check. */
  lastCheckedAt: string | null
  /** Whether a check is currently in progress. */
  checking: boolean

  // Actions
  /** Called when DataBus dispatches an `update:check-result` event. */
  onCheckResult: (result: import('@shared/types').UpdateCheckResult) => void
  /** Dismiss the update banner for the current latest version. */
  dismissUpdate: () => void
  /** Trigger a manual update check via IPC. */
  checkForUpdates: () => Promise<void>
}

// ─── Persisted dismiss state ──────────────────────────────────────────

const DISMISSED_VERSION_KEY = 'opencow:update:dismissed-version'

function loadDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_VERSION_KEY)
  } catch {
    return null
  }
}

function saveDismissedVersion(version: string | null): void {
  try {
    if (version) {
      localStorage.setItem(DISMISSED_VERSION_KEY, version)
    } else {
      localStorage.removeItem(DISMISSED_VERSION_KEY)
    }
  } catch {
    // localStorage unavailable — ignore
  }
}

// ─── Store ────────────────────────────────────────────────────────────

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateAvailable: false,
  latestVersion: null,
  releaseUrl: null,
  releaseNotes: null,
  downloadUrl: null,
  publishedAt: null,
  dismissedVersion: loadDismissedVersion(),
  lastCheckedAt: null,
  checking: false,

  onCheckResult: (result) => {
    if (result.status === 'available') {
      set({
        updateAvailable: true,
        latestVersion: result.latestVersion,
        releaseUrl: result.releaseUrl,
        releaseNotes: result.releaseNotes,
        downloadUrl: result.downloadUrl,
        publishedAt: result.publishedAt,
        lastCheckedAt: result.checkedAt,
        checking: false,
      })
    } else {
      set({
        updateAvailable: false,
        lastCheckedAt: result.checkedAt,
        checking: false,
      })
    }
  },

  dismissUpdate: () => {
    const { latestVersion } = get()
    saveDismissedVersion(latestVersion)
    set({ dismissedVersion: latestVersion })
  },

  checkForUpdates: async () => {
    set({ checking: true })
    try {
      await getAppAPI()['check-for-updates']()
      // Result arrives via DataBus event → onCheckResult
    } catch {
      set({ checking: false })
    }
  },
}))
