// SPDX-License-Identifier: Apache-2.0

/**
 * useProviderLogin — Shared provider authentication orchestration.
 *
 * Extracts the login / cancel-login workflow used by both ProviderSection
 * (Settings modal) and ProviderSetupStep (Onboarding).
 *
 * Responsibilities:
 *   - Update settings with selected engine + mode
 *   - Call provider:login IPC
 *   - Sync resulting ProviderStatus to settingsStore
 *   - Expose loading / error transient state
 */

import { useState, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAppAPI } from '@/windowAPI'
import type {
  AIEngineKind,
  ApiProvider,
  AppSettings,
  ProviderStatus,
} from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────

export interface ProviderLoginOptions {
  /** Also set this engine as the global default. */
  setAsDefaultEngine?: boolean
}

export interface ProviderLoginResult {
  status: ProviderStatus
  success: boolean
}

export interface UseProviderLoginReturn {
  loading: boolean
  error: string | null
  login: (
    engineKind: AIEngineKind,
    mode: ApiProvider,
    params?: Record<string, unknown>,
    options?: ProviderLoginOptions,
  ) => Promise<ProviderLoginResult>
  cancelLogin: (engineKind: AIEngineKind, mode: ApiProvider) => Promise<void>
  clearError: () => void
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useProviderLogin(): UseProviderLoginReturn {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setProviderStatusForEngine = useSettingsStore((s) => s.setProviderStatusForEngine)

  const login = useCallback(
    async (
      engineKind: AIEngineKind,
      mode: ApiProvider,
      params?: Record<string, unknown>,
      options?: ProviderLoginOptions,
    ): Promise<ProviderLoginResult> => {
      setLoading(true)
      setError(null)

      try {
        // 1. Build next settings — set activeMode (and optionally defaultEngine)
        const currentSettings = useSettingsStore.getState().settings!
        const nextSettings: AppSettings = {
          ...currentSettings,
          ...(options?.setAsDefaultEngine
            ? { command: { ...currentSettings.command, defaultEngine: engineKind } }
            : {}),
          provider: {
            ...currentSettings.provider,
            byEngine: {
              ...currentSettings.provider.byEngine,
              [engineKind]: {
                ...(currentSettings.provider.byEngine[engineKind] ?? { activeMode: null }),
                activeMode: mode,
              },
            },
          },
        }

        // 2. Persist settings (IPC) + optimistic store update
        await getAppAPI()['update-settings'](nextSettings)
        useSettingsStore.getState().setSettings(nextSettings)

        // 3. Call provider:login IPC
        const status = await getAppAPI()['provider:login'](engineKind, mode, params)
        setProviderStatusForEngine({ engineKind, status, syncGlobal: true })

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
    [setProviderStatusForEngine],
  )

  const cancelLogin = useCallback(
    async (engineKind: AIEngineKind, mode: ApiProvider): Promise<void> => {
      try {
        await getAppAPI()['provider:cancel-login'](engineKind, mode)
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
