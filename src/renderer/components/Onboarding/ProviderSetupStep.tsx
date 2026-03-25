// SPDX-License-Identifier: Apache-2.0

/**
 * ProviderSetupStep — Onboarding step for configuring the AI provider.
 *
 * Design decisions:
 *   - Reuses PROVIDER_MODES_BY_ENGINE & ENGINE_TABS from Settings/provider/constants
 *     as the single source of truth for modes (no duplication).
 *   - Reuses CredentialForms from Settings/provider for credential input.
 *   - Uses useProviderLogin hook for shared login orchestration.
 *   - Reads i18n from both 'onboarding' (step-specific) and 'settings' (mode labels)
 *     namespaces to avoid duplicating translations.
 *   - Communicates "provider configured" state upward via onProviderConfigured callback
 *     so the orchestrator can pass it to DoneStep (preserving the prop-driven pattern).
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProviderLogin } from '@/hooks/useProviderLogin'
import type { AIEngineKind, ApiProvider, ProviderCredentialInfo } from '@shared/types'
import {
  ENGINE_TABS,
  PROVIDER_MODES_BY_ENGINE,
  getModeLabelKey,
  type ProviderModeOption,
} from '../Settings/provider/constants'
import { ApiKeyForm, OpenRouterForm, CustomCredentialForm } from '../Settings/provider/CredentialForms'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

// ─── Types ──────────────────────────────────────────────────────────────

interface ProviderSetupStepProps {
  stepConfig: StepConfig
  onBack: () => void
  onContinue: () => void
  /** Called when provider authentication state changes. */
  onProviderConfigured: (configured: boolean) => void
}

type SetupPhase = 'selecting' | 'authenticated'

// ─── Sub-Components ─────────────────────────────────────────────────────

function EngineCard({
  engineTab,
  recommended,
  selected,
  onSelect,
}: {
  engineTab: (typeof ENGINE_TABS)[number]
  recommended?: boolean
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { t: tOnboarding } = useTranslation('onboarding')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex-1 rounded-xl border-2 px-4 py-3 text-left transition-all',
        selected
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--foreground)/0.02)]',
      )}
    >
      <span className="text-sm font-semibold">{t(engineTab.labelKey)}</span>
      {recommended && (
        <span className="ml-2 inline-flex items-center rounded-md bg-[hsl(var(--primary)/0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
          {tOnboarding('providerSetup.recommended')}
        </span>
      )}
      {selected && (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--primary))]">
          <Check className="h-3 w-3 text-[hsl(var(--primary-foreground))]" />
        </span>
      )}
    </button>
  )
}

function ModeRadioItem({
  modeOption,
  selected,
  onSelect,
}: {
  modeOption: ProviderModeOption
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const Icon = modeOption.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
        selected
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.3)] hover:bg-[hsl(var(--foreground)/0.02)]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          selected ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--muted-foreground)/0.4)]',
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <span className="text-sm font-medium">{t(modeOption.labelKey)}</span>
        </div>
        <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{t(modeOption.descKey)}</p>
      </div>
    </button>
  )
}

function SuccessCard({
  engineLabel,
  modeLabel,
  onReset,
}: {
  engineLabel: string
  modeLabel: string
  onReset: () => void
}): React.JSX.Element {
  const { t } = useTranslation('onboarding')

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-4 w-4 text-emerald-500" />
        </div>
        <span className="text-sm font-semibold text-emerald-500">
          {t('providerSetup.success.title')}
        </span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">{t('providerSetup.success.engine')}</span>
          <span className="font-medium">{engineLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">{t('providerSetup.success.mode')}</span>
          <span className="font-medium">{modeLabel}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">{t('providerSetup.success.status')}</span>
          <span className="font-medium text-emerald-500">{t('providerSetup.success.authenticated')}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-3 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors underline"
      >
        {t('providerSetup.success.changeConfig')}
      </button>
    </div>
  )
}

function SubscriptionLoginPanel({
  loading,
  onLogin,
  onCancel,
}: {
  loading: boolean
  onLogin: () => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const { t: tc } = useTranslation('common')

  return (
    <div className="space-y-3 mt-3">
      {!loading ? (
        <button
          type="button"
          onClick={onLogin}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
            'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
            'hover:bg-[hsl(var(--primary)/0.9)]',
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          {t('providerSetup.loginWithClaude')}
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm text-amber-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {t('providerSetup.waitingForAuth')}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline transition-colors"
          >
            {tc('cancel')}
          </button>
        </div>
      )}
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        {t('providerSetup.subscriptionHint')}
      </p>
    </div>
  )
}

/** Renders the correct credential form for the given mode. */
function CredentialFormForMode({
  engineKind,
  mode,
  loading,
  initialValues,
  onLogin,
  onCancel,
}: {
  engineKind: AIEngineKind
  mode: ApiProvider
  loading: boolean
  initialValues: ProviderCredentialInfo | null
  onLogin: (mode: ApiProvider, params?: Record<string, unknown>) => void
  onCancel: () => void
}): React.JSX.Element {
  if (mode === 'subscription') {
    return (
      <SubscriptionLoginPanel
        loading={loading}
        onLogin={() => onLogin('subscription')}
        onCancel={onCancel}
      />
    )
  }
  if (mode === 'api_key') {
    return (
      <ApiKeyForm
        initialValues={initialValues}
        loading={loading}
        onSubmit={(params) => onLogin('api_key', params)}
      />
    )
  }
  if (mode === 'openrouter') {
    return (
      <OpenRouterForm
        initialValues={initialValues}
        loading={loading}
        onSubmit={(params) => onLogin('openrouter', params)}
      />
    )
  }
  return (
    <CustomCredentialForm
      initialValues={initialValues}
      loading={loading}
      forceBearer={engineKind === 'codex'}
      onSubmit={(params) => onLogin('custom', params)}
    />
  )
}

// ─── Main Component ─────────────────────────────────────────────────────

export function ProviderSetupStep({
  stepConfig,
  onBack,
  onContinue,
  onProviderConfigured,
}: ProviderSetupStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const { t: tSettings } = useTranslation('settings')

  // ── Shared login hook ──
  const { loading, error, login, cancelLogin, clearError } = useProviderLogin()

  // ── Store reads ──
  const providerStatusByEngine = useSettingsStore((s) => s.providerStatusByEngine)
  const loadProviderStatus = useSettingsStore((s) => s.loadProviderStatus)

  // ── Local state ──
  const [selectedEngine, setSelectedEngine] = useState<AIEngineKind>('claude')
  const [selectedMode, setSelectedMode] = useState<ApiProvider | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [phase, setPhase] = useState<SetupPhase>('selecting')
  const [editValues] = useState<ProviderCredentialInfo | null>(null)

  // Ref: when the user explicitly clicks "change config", we must prevent the
  // auth-sync effect from immediately reverting to 'authenticated'.
  const userResetRef = useRef(false)

  // ── Derived data from single source of truth ──
  const modes = PROVIDER_MODES_BY_ENGINE[selectedEngine]
  const primaryModes = useMemo(() => modes.filter((m) => !m.advanced), [modes])
  const advancedModes = useMemo(() => modes.filter((m) => m.advanced), [modes])
  const currentStatus = providerStatusByEngine[selectedEngine]

  // ── Sync: if the store says "authenticated", reflect it (unless user just clicked reset) ──
  useEffect(() => {
    if (userResetRef.current) return
    if (currentStatus?.state === 'authenticated' && currentStatus.mode) {
      setSelectedMode(currentStatus.mode)
      setPhase('authenticated')
      onProviderConfigured(true)
    }
  }, [currentStatus, onProviderConfigured])

  // ── Refresh status when engine tab changes ──
  useEffect(() => {
    void loadProviderStatus({ engineKind: selectedEngine, syncGlobal: false })
  }, [selectedEngine, loadProviderStatus])

  // ── Handlers ──

  const handleEngineSelect = useCallback((engine: AIEngineKind) => {
    userResetRef.current = false
    setSelectedEngine(engine)
    setSelectedMode(null)
    setShowAdvanced(false)
    setPhase('selecting')
    clearError()
  }, [clearError])

  const handleModeSelect = useCallback((mode: ApiProvider) => {
    userResetRef.current = false
    setSelectedMode(mode)
    setPhase('selecting')
    clearError()
  }, [clearError])

  const handleResetToSelecting = useCallback(() => {
    userResetRef.current = true
    setPhase('selecting')
    clearError()
  }, [clearError])

  const handleLogin = useCallback(
    async (mode: ApiProvider, params?: Record<string, unknown>) => {
      userResetRef.current = false
      const result = await login(selectedEngine, mode, params, { setAsDefaultEngine: true })
      if (result.success) {
        setPhase('authenticated')
        onProviderConfigured(true)
      }
    },
    [selectedEngine, login, onProviderConfigured],
  )

  const handleCancelLogin = useCallback(async () => {
    if (!selectedMode) return
    await cancelLogin(selectedEngine, selectedMode)
  }, [selectedEngine, selectedMode, cancelLogin])

  // ── Resolve display labels ──
  const engineTab = ENGINE_TABS.find((e) => e.kind === selectedEngine)!
  const engineLabel = tSettings(engineTab.labelKey)
  const modeLabelKey = getModeLabelKey(selectedEngine, selectedMode)
  const modeLabel = modeLabelKey ? tSettings(modeLabelKey) : ''

  // ── Render ──
  return (
    <div className="onboarding-step-enter">
      <StepIndicator {...stepConfig} />

      {/* Header */}
      <div className="text-center mb-5">
        <h2 className="text-xl font-bold mb-1">{t('providerSetup.title')}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{t('providerSetup.subtitle')}</p>
      </div>

      {/* Content card */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 mb-5">
        {phase === 'authenticated' ? (
          <SuccessCard engineLabel={engineLabel} modeLabel={modeLabel} onReset={handleResetToSelecting} />
        ) : (
          <div className="space-y-4">
            {/* Engine selector */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                {t('providerSetup.selectEngine')}
              </label>
              <div className="flex gap-2">
                {ENGINE_TABS.map((tab) => (
                  <EngineCard
                    key={tab.kind}
                    engineTab={tab}
                    recommended={tab.kind === 'claude'}
                    selected={selectedEngine === tab.kind}
                    onSelect={() => handleEngineSelect(tab.kind)}
                  />
                ))}
              </div>
            </div>

            {/* Mode selector */}
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                {t('providerSetup.selectMode')}
              </label>
              <div className="space-y-1.5">
                {primaryModes.map((modeOption) => (
                  <ModeRadioItem
                    key={modeOption.mode}
                    modeOption={modeOption}
                    selected={selectedMode === modeOption.mode}
                    onSelect={() => handleModeSelect(modeOption.mode)}
                  />
                ))}

                {advancedModes.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((v) => !v)}
                      className="flex items-center gap-1.5 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                    >
                      {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      {t('providerSetup.moreOptions')}
                    </button>
                    {showAdvanced &&
                      advancedModes.map((modeOption) => (
                        <ModeRadioItem
                          key={modeOption.mode}
                          modeOption={modeOption}
                          selected={selectedMode === modeOption.mode}
                          onSelect={() => handleModeSelect(modeOption.mode)}
                        />
                      ))}
                  </>
                )}
              </div>
            </div>

            {/* Credential form */}
            {selectedMode && (
              <div className="rounded-lg bg-[hsl(var(--background))] border border-[hsl(var(--border))] p-3">
                <CredentialFormForMode
                  engineKind={selectedEngine}
                  mode={selectedMode}
                  loading={loading}
                  initialValues={editValues}
                  onLogin={(mode, params) => void handleLogin(mode, params)}
                  onCancel={() => void handleCancelLogin()}
                />
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('common.back')}
        </button>

        <div className="flex items-center gap-3">
          {phase !== 'authenticated' && (
            <button
              type="button"
              onClick={onContinue}
              className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              {t('common.skipForNow')}
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium transition-opacity',
              phase === 'authenticated'
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90'
                : 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.12)]',
            )}
          >
            {t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
