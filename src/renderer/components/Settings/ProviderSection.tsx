// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAppAPI } from '@/windowAPI'
import type { ApiProvider, ProviderCredentialInfo, ProviderStatus } from '@shared/types'
import {
  PROVIDER_MODES,
  MODEL_SUGGESTIONS,
} from './provider/constants'
import { ModeCredentialStep } from './provider/ModeCredentialStep'

interface StepHeaderProps {
  step: number
  title: string
  description: string
}

function StepHeader({ step, title, description }: StepHeaderProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  return (
    <div className="mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.8)]">
        {t('provider.steps.stepLabel', { step })}
      </p>
      <h5 className="mt-0.5 text-sm font-medium">{title}</h5>
      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
    </div>
  )
}

const VALID_PROVIDER_MODES = new Set<ApiProvider>(PROVIDER_MODES.map((m) => m.mode))

export function ProviderSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((store) => store.settings)!
  const providerStatus = useSettingsStore((store) => store.providerStatus)
  const setSettings = useSettingsStore((store) => store.setSettings)
  const setProviderStatus = useSettingsStore((store) => store.setProviderStatus)
  const loadProviderStatus = useSettingsStore((store) => store.loadProviderStatus)
  const updateSettings = useSettingsStore((store) => store.updateSettings)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editValues, setEditValues] = useState<ProviderCredentialInfo | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)

  const activeMode = settings.provider.activeMode
  const defaultModel = settings.provider.defaultModel
  const modeSupported = !activeMode || VALID_PROVIDER_MODES.has(activeMode)
  const effectiveActiveMode = modeSupported ? activeMode : null

  const isStatusForActiveMode = providerStatus?.mode === effectiveActiveMode
  const isAuthenticated = isStatusForActiveMode && providerStatus?.state === 'authenticated'
  const isAuthenticating = !isAuthenticated
    && ((isStatusForActiveMode && providerStatus?.state === 'authenticating') || loading)

  const resetTransientState = useCallback(() => {
    setError(null)
    setIsEditing(false)
    setEditValues(null)
  }, [])

  const refreshStatus = useCallback(
    async (force = false) => loadProviderStatus({ force }),
    [loadProviderStatus],
  )

  useEffect(() => {
    setCheckingStatus(true)
    void refreshStatus().finally(() => setCheckingStatus(false))
  }, [refreshStatus])

  const handleModeSelect = useCallback(async (mode: ApiProvider) => {
    resetTransientState()
    setCheckingStatus(true)

    if (activeMode === mode) {
      await refreshStatus(true)
      setCheckingStatus(false)
      return
    }

    const optimisticStatus: ProviderStatus = { state: 'unauthenticated', mode }
    setProviderStatus({ status: optimisticStatus })

    try {
      const nextSettings = {
        ...settings,
        provider: {
          ...settings.provider,
          activeMode: mode,
        },
      }
      setSettings(nextSettings)
      await getAppAPI()['update-settings'](nextSettings)
      await refreshStatus(true)
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : String(eventError))
    } finally {
      setCheckingStatus(false)
    }
  }, [activeMode, refreshStatus, resetTransientState, setProviderStatus, setSettings, settings])

  const handleStartEditing = useCallback(async () => {
    if (!effectiveActiveMode) return
    const credential = await getAppAPI()['provider:get-credential'](effectiveActiveMode).catch(() => null)
    setEditValues(credential)
    setIsEditing(true)
  }, [effectiveActiveMode])

  const handleLogin = useCallback(async (mode: ApiProvider, params?: Record<string, unknown>) => {
    setLoading(true)
    setError(null)
    try {
      const status = await getAppAPI()['provider:login'](mode, params)
      setProviderStatus({ status })
      if (status.state === 'error' && status.error) {
        setError(status.error)
      } else {
        setIsEditing(false)
      }
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : String(eventError))
    } finally {
      setLoading(false)
    }
  }, [setProviderStatus])

  const handleCancelLogin = useCallback(async () => {
    if (!effectiveActiveMode) return
    setLoading(true)
    try {
      await getAppAPI()['provider:cancel-login'](effectiveActiveMode)
      await refreshStatus(true)
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : String(eventError))
    } finally {
      setLoading(false)
    }
  }, [effectiveActiveMode, refreshStatus])

  const handleLogout = useCallback(async () => {
    if (!effectiveActiveMode) return
    setLoading(true)
    resetTransientState()
    try {
      await getAppAPI()['provider:logout'](effectiveActiveMode)
      const unauthenticatedStatus: ProviderStatus = { state: 'unauthenticated', mode: effectiveActiveMode }
      setProviderStatus({ status: unauthenticatedStatus })
    } catch (eventError) {
      setError(eventError instanceof Error ? eventError.message : String(eventError))
    } finally {
      setLoading(false)
    }
  }, [effectiveActiveMode, resetTransientState, setProviderStatus])

  // ── Debounced default model input ──────────────────────────────────────
  // Local state provides instant keystroke feedback; the actual settings
  // update (global store + IPC persist) is debounced to avoid hammering
  // the backend on every character.
  const [localModelInput, setLocalModelInput] = useState(defaultModel ?? '')

  const modelUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleDefaultModelChange = useCallback((nextValue: string) => {
    setLocalModelInput(nextValue) // immediate UI update

    // Debounce the expensive global settings update + IPC persistence
    if (modelUpdateTimerRef.current) clearTimeout(modelUpdateTimerRef.current)
    modelUpdateTimerRef.current = setTimeout(() => {
      updateSettings({
        ...settings,
        provider: {
          ...settings.provider,
          defaultModel: nextValue || undefined,
        },
      })
    }, 300)
  }, [settings, updateSettings])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (modelUpdateTimerRef.current) clearTimeout(modelUpdateTimerRef.current)
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t('provider.title')}</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('provider.description')}</p>
      </div>

      <section className="rounded-lg bg-[hsl(var(--foreground)/0.03)] p-4">
        <StepHeader
          step={1}
          title={t('provider.steps.modeCredential.title')}
          description={t('provider.steps.modeCredential.description')}
        />
        <ModeCredentialStep
          providerModes={PROVIDER_MODES}
          activeMode={activeMode}
          effectiveActiveMode={effectiveActiveMode}
          modeSupported={modeSupported}
          onModeSelect={handleModeSelect}
          credential={{
            state: {
              checkingStatus,
              isAuthenticated: Boolean(isAuthenticated),
              isAuthenticating: Boolean(isAuthenticating),
              isEditing,
              status: providerStatus,
              initialValues: editValues,
            },
            actions: {
              onLogin: handleLogin,
              onLogout: handleLogout,
              onCancelLogin: handleCancelLogin,
              onStartEditing: handleStartEditing,
              onCancelEditing: resetTransientState,
            },
          }}
        />
      </section>

      <section className="rounded-lg bg-[hsl(var(--foreground)/0.03)] p-4">
        <StepHeader
          step={2}
          title={t('provider.steps.model.title')}
          description={t('provider.steps.model.description')}
        />
        <label className="block text-sm font-medium mb-1">
          {t('provider.defaultModel')}
          <span className="ml-1.5 text-xs font-normal text-[hsl(var(--muted-foreground))]">{t('provider.optional')}</span>
        </label>
        <input
          type="text"
          disabled={!effectiveActiveMode}
          list="provider-model-options"
          value={localModelInput}
          onChange={(event) => handleDefaultModelChange(event.target.value)}
          placeholder={t('provider.defaultModelPlaceholder')}
          className={cn(
            'w-full rounded-md border bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none font-mono',
            'focus:ring-2 focus:ring-[hsl(var(--ring))]',
            'border-[hsl(var(--border))]',
            !effectiveActiveMode && 'opacity-60 cursor-not-allowed',
          )}
        />
        <datalist id="provider-model-options">
          {MODEL_SUGGESTIONS.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          {effectiveActiveMode ? t('provider.defaultModelHint') : t('provider.steps.model.empty')}
        </p>
      </section>

      {checkingStatus && (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('provider.status.checking')}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  )
}
