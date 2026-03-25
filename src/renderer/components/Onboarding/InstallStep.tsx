// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

/** Sub-step progress state for the install phase */
type InstallPhase =
  | 'idle'
  | 'creating-dir'
  | 'writing-script'
  | 'registering-hooks'
  | 'verifying'
  | 'success'
  | 'failed'

/** Phase keys in execution order (used for progress tracking). */
const PHASE_KEYS = [
  'creating-dir',
  'writing-script',
  'registering-hooks',
  'verifying',
] as const

type PhaseKey = typeof PHASE_KEYS[number]

/** Number of hook events that will be registered. */
const HOOK_EVENT_COUNT = 9

interface InstallStepProps {
  stepConfig: StepConfig
  onBack: () => void
  onSkip: () => void
  onInstalled: () => void
}

/** Install sub-step row with spinner → check animation */
function InstallPhaseRow({
  label,
  status,
}: {
  label: string
  status: 'pending' | 'active' | 'done' | 'failed'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-3 py-2 transition-opacity duration-300',
        status === 'pending' ? 'opacity-40' : 'opacity-100'
      )}
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {status === 'pending' && (
          <div className="h-2 w-2 rounded-full bg-[hsl(var(--muted-foreground)/0.3)]" />
        )}
        {status === 'active' && <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--primary))]" />}
        {status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
      </div>
      <span
        className={cn(
          'text-sm',
          status === 'active' && 'font-medium',
          status === 'failed' && 'text-red-500'
        )}
      >
        {label}
      </span>
    </div>
  )
}

export function InstallStep({
  stepConfig,
  onBack,
  onSkip,
  onInstalled,
}: InstallStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const [installPhase, setInstallPhase] = useState<InstallPhase>('idle')

  const getPhaseStatus = useCallback(
    (phase: PhaseKey): 'pending' | 'active' | 'done' | 'failed' => {
      if (installPhase === 'failed') {
        const phaseIndex = PHASE_KEYS.indexOf(phase)
        const failedIndex = PHASE_KEYS.length - 1
        if (phaseIndex < failedIndex) return 'done'
        if (phaseIndex === failedIndex) return 'failed'
        return 'pending'
      }
      if (installPhase === 'success') return 'done'

      const currentIdx = PHASE_KEYS.indexOf(installPhase as PhaseKey)
      const targetIdx = PHASE_KEYS.indexOf(phase)

      if (currentIdx < 0) return 'pending' // idle
      if (targetIdx < currentIdx) return 'done'
      if (targetIdx === currentIdx) return 'active'
      return 'pending'
    },
    [installPhase]
  )

  /** Animate through install phases, then call the real install */
  const handleInstall = async (): Promise<void> => {
    setInstallPhase('creating-dir')
    await delay(400)

    setInstallPhase('writing-script')
    await delay(350)

    setInstallPhase('registering-hooks')
    try {
      const success = await getAppAPI()['install-hooks']()
      if (!success) {
        setInstallPhase('failed')
        return
      }
    } catch {
      setInstallPhase('failed')
      return
    }

    setInstallPhase('verifying')
    await delay(300)
    setInstallPhase('success')

    // Auto-advance to import step after a brief celebration
    setTimeout(onInstalled, 1200)
  }

  const handleRetry = (): void => {
    setInstallPhase('idle')
  }

  const statusText =
    installPhase === 'idle'
      ? t('install.statusIdle')
      : installPhase === 'success'
        ? t('install.statusSuccess')
        : installPhase === 'failed'
          ? t('install.statusFailed')
          : t('install.statusInProgress')

  return (
    <div className="onboarding-step-enter">
      <StepIndicator {...stepConfig} />

      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1.5">{t('install.title')}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{statusText}</p>
      </div>

      {/* Install progress steps */}
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4 mb-6">
        {installPhase === 'idle' ? (
          /* Pre-install summary */
          <div className="space-y-3 text-left">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('install.preSummary')}
            </p>
            <ul className="space-y-2 text-sm text-[hsl(var(--foreground))]">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
                {t('install.preStepCreateDir', { path: '~/.opencow/' })}
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
                {t('install.preStepWriteScript')}
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
                {t('install.preStepRegisterHooks', {
                  count: HOOK_EVENT_COUNT,
                  path: '~/.claude/settings.json',
                })}
              </li>
            </ul>
          </div>
        ) : (
          /* Animated progress */
          <div className="space-y-0.5">
            {PHASE_KEYS.map((key) => (
              <InstallPhaseRow
                key={key}
                label={t(`install.phases.${key}`)}
                status={getPhaseStatus(key)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {installPhase === 'idle' && (
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={t('common.back')}
          >
            {t('common.back')}
          </button>
          <button
            onClick={() => void handleInstall()}
            className="px-5 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity"
            aria-label={t('install.installNow')}
          >
            {t('install.installNow')}
          </button>
        </div>
      )}

      {installPhase === 'failed' && (
        <div className="flex items-center justify-between">
          <button
            onClick={onSkip}
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={t('common.skipForNow')}
          >
            {t('common.skipForNow')}
          </button>
          <button
            onClick={handleRetry}
            className="px-5 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity"
            aria-label={t('common.retry')}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {installPhase === 'success' && (
        <div className="text-center">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t('install.proceeding')}
          </p>
        </div>
      )}

      {installPhase !== 'idle' &&
        installPhase !== 'failed' &&
        installPhase !== 'success' && (
          <div className="text-center">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('install.pleaseWait')}
            </p>
          </div>
        )}
    </div>
  )
}

/** Simple delay helper */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
