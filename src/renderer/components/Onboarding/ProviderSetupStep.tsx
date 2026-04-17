// SPDX-License-Identifier: Apache-2.0

/**
 * Onboarding → Provider Setup step (Phase B.7 cutover).
 *
 * Minimal by design: the onboarding flow should not re-implement the
 * full Settings Provider UI. Users get a single fast path — enter an
 * Anthropic API key — or jump to full Settings for advanced providers
 * (Claude OAuth / OpenAI / Gemini / proxies).
 *
 * If migration already populated profiles from a prior OpenCow install,
 * the step auto-advances so the user never sees an unnecessary prompt.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAppAPI } from '@/windowAPI'

interface ProviderSetupStepProps {
  stepConfig: { stepNumber: number; totalSteps: number }
  onBack: () => void
  onContinue: () => void
  onProviderConfigured: (configured: boolean) => void
}

export function ProviderSetupStep({
  stepConfig,
  onBack,
  onContinue,
  onProviderConfigured,
}: ProviderSetupStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const settings = useSettingsStore((s) => s.settings)
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)

  const hasProfiles = useMemo(
    () => (settings?.provider.profiles.length ?? 0) > 0,
    [settings?.provider.profiles],
  )

  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-mark configured when profiles already exist (migration or
  // prior configuration).
  useEffect(() => {
    if (hasProfiles) onProviderConfigured(true)
  }, [hasProfiles, onProviderConfigured])

  const handleQuickAdd = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await getAppAPI()['provider:create-profile']({
        name: 'Anthropic API',
        credential: { type: 'anthropic-api' },
        authParams: { apiKey: apiKey.trim() },
        setAsDefault: true,
      })
      onProviderConfigured(true)
      onContinue()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [apiKey, onContinue, onProviderConfigured])

  const handleAdvanced = useCallback(() => {
    openSettingsModal('provider')
  }, [openSettingsModal])

  return (
    <div className="flex flex-col">
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.8)]">
          {t('stepLabel', { current: stepConfig.stepNumber, total: stepConfig.totalSteps })}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{t('providerSetup.title')}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {t('providerSetup.description')}
        </p>
      </div>

      {hasProfiles ? (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <p className="text-sm text-green-400">
            {t('providerSetup.alreadyConfigured', {
              count: settings?.provider.profiles.length,
              defaultValue: 'Your provider configuration was imported. You can review and edit it in Settings at any time.',
            })}
          </p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--foreground)/0.02)] p-4">
          <label className="block">
            <span className="block text-xs font-medium mb-1">{t('providerSetup.apiKeyLabel')}</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className={cn(
                'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm outline-none font-mono',
                'focus:ring-2 focus:ring-[hsl(var(--ring))]',
              )}
            />
          </label>
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleAdvanced}
              className="text-xs text-[hsl(var(--muted-foreground))] underline hover:text-[hsl(var(--foreground))]"
            >
              {t('providerSetup.advanced')}
            </button>
            <button
              type="button"
              disabled={busy || !apiKey.trim()}
              onClick={handleQuickAdd}
              className="text-xs px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t('providerSetup.saving') : t('providerSetup.save')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-xs px-3 py-1.5 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]"
        >
          {t('back')}
        </button>
        <button
          type="button"
          onClick={onContinue}
          className={cn(
            'text-xs px-3 py-1.5 rounded-md',
            hasProfiles
              ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
              : 'border border-[hsl(var(--border))] hover:bg-[hsl(var(--foreground)/0.04)]',
          )}
        >
          {hasProfiles ? t('continue') : t('providerSetup.skip')}
        </button>
      </div>
    </div>
  )
}
