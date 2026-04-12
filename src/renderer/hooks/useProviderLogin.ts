// SPDX-License-Identifier: Apache-2.0

/**
 * useProviderLogin — Shared provider authentication orchestration.
 *
 * Extracts the login / cancel-login workflow used by both ProviderSection
 * (Settings modal) and ProviderSetupStep (Onboarding).
 *
 * Responsibilities:
 *   - Update settings with selected mode
 *   - Call provider:login IPC
 *   - Sync resulting ProviderStatus to settingsStore
 *   - Expose loading / error transient state
 */

import { useState, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAppAPI } from '@/windowAPI'
import type {
  ApiProvider,
  AppSettings,
  ProviderStatus,
} from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────

export interface ProviderLoginResult {
  status: ProviderStatus
  success: boolean
}

export interface UseProviderLoginReturn {
  loading: boolean
  error: string | null
  login: (
    mode: ApiProvider,
    params?: Record<string, unknown>,
  ) => Promise<ProviderLoginResult>
  cancelLogin: (mode: ApiProvider) => Promise<void>
  clearError: () => void
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useProviderLogin(): UseProviderLoginReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setProviderStatus = useSettingsStore((s) => s.setProviderStatus)

  const login = useCallback(
    async (
      mode: ApiProvider,
      params?: Record<string, unknown>,
    ): Promise<ProviderLoginResult> => {
      setLoading(true)
      setError(null)

      try {
        // 1. Update settings with selected activeMode
        const currentSettings = useSettingsStore.getState().settings!
        const nextSettings: AppSettings = {
          ...currentSettings,
          provider: {
            ...currentSettings.provider,
            activeMode: mode,
          },
        }

        // 2. Persist settings (IPC) + optimistic store update
        await getAppAPI()['update-settings'](nextSettings)
        useSettingsStore.getState().setSettings(nextSettings)

        // 3. Call provider:login IPC
        const status = await getAppAPI()['provider:login'](mode, params)
        setProviderStatus({ status })

        // 4. Surface errors
        if (status.state === 'error' && status.error) {
          setError(status.error)
        }

        return { status, success: status.state === 'authenticated' }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed'
        setError(message)
        return {
          status: { state: 'error', mode, error: message },
          success: false,
        }
      } finally {
        setLoading(false)
      }
    },
    [setProviderStatus],
  )

  const cancelLogin = useCallback(
    async (mode: ApiProvider): Promise<void> => {
      try {
        await getAppAPI()['provider:cancel-login'](mode)
      } catch {
        // Best-effort cancel — don't propagate
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const clearError = useCallback(() => setError(null), [])

  return { loading, error, login, cancelLogin, clearError }
}
