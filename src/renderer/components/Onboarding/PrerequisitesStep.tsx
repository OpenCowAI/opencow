// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { PrerequisiteCheckResult, PrerequisiteItem } from '@shared/types'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

type PrereqPhase = 'checking' | 'done' | 'error'

interface PrerequisitesStepProps {
  stepConfig: StepConfig
  onResult: (result: PrerequisiteCheckResult) => void
  onBack: () => void
  onContinue: () => void
}

/** Prerequisite check row */
function PrerequisiteRow({ item }: { item: PrerequisiteItem }): React.JSX.Element {
  const { t } = useTranslation('onboarding')

  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center mt-0.5">
        {item.satisfied ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : item.required ? (
          <XCircle className="h-4 w-4 text-red-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{item.name}</span>
          {item.version && (
            <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
              v{item.version}
            </code>
          )}
          {!item.required && (
            <span className="rounded-full bg-[hsl(var(--accent))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
              {t('prerequisites.optional')}
            </span>
          )}
        </div>
        {!item.satisfied && item.hint && (
          <p
            className={cn(
              'text-xs mt-1',
              item.required
                ? 'text-red-500/80'
                : 'text-[hsl(var(--muted-foreground))]'
            )}
          >
            {item.hint}
          </p>
        )}
      </div>
    </div>
  )
}

export function PrerequisitesStep({
  stepConfig,
  onResult,
  onBack,
  onContinue,
}: PrerequisitesStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const [phase, setPhase] = useState<PrereqPhase>('checking')
  const [result, setResult] = useState<PrerequisiteCheckResult | null>(null)

  // Auto-run on mount. onResult is stable (useCallback with [] deps in parent).
  useEffect(() => {
    let cancelled = false

    getAppAPI()['check-prerequisites']()
      .then((checkResult) => {
        if (cancelled) return
        setResult(checkResult)
        setPhase('done')
        onResult(checkResult)
      })
      .catch(() => {
        if (!cancelled) setPhase('error')
      })

    return () => { cancelled = true }
  }, [onResult])

  const handleRecheck = useCallback(async () => {
    setPhase('checking')
    setResult(null)
    try {
      const checkResult = await getAppAPI()['check-prerequisites']()
      setResult(checkResult)
      setPhase('done')
      onResult(checkResult)
    } catch {
      setPhase('error')
    }
  }, [onResult])

  const claudeCodeAvailable = result?.items.find((i) => i.name === 'Claude Code')?.satisfied ?? false

  const statusText =
    phase === 'checking'
      ? t('prerequisites.statusChecking')
      : phase === 'error'
        ? t('prerequisites.statusError')
        : t('prerequisites.statusDone')

  return (
    <div className="onboarding-step-enter">
      <StepIndicator {...stepConfig} />

      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1.5">{t('prerequisites.title')}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{statusText}</p>
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-3 mb-6">
        {phase === 'checking' ? (
          <div className="flex items-center justify-center py-8 gap-2.5">
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('prerequisites.detecting')}
            </span>
          </div>
        ) : phase === 'error' ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <XCircle className="h-8 w-8 text-red-500/60" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t('prerequisites.errorDetail')}
            </p>
            <button
              onClick={() => void handleRecheck()}
              className="flex items-center gap-1.5 text-sm text-[hsl(var(--primary))] hover:opacity-80 transition-opacity"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('prerequisites.tryAgain')}
            </button>
          </div>
        ) : result ? (
          <div className="divide-y divide-[hsl(var(--border))]">
            {result.items.map((item) => (
              <PrerequisiteRow key={item.name} item={item} />
            ))}
          </div>
        ) : null}
      </div>

      {/* Contextual hint when Claude Code is missing */}
      {phase === 'done' && result && !claudeCodeAvailable && result.canProceed && (
        <div className="flex items-start gap-2.5 rounded-lg bg-[hsl(var(--accent))] px-4 py-3 mb-6">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
          <div className="text-xs text-[hsl(var(--muted-foreground))] text-left space-y-1">
            <p>
              <strong className="text-[hsl(var(--foreground))]">
                {t('prerequisites.claudeOptionalTitle')}
              </strong>{' '}
              {t('prerequisites.claudeOptionalDesc')}{' '}
              <span className="font-medium text-[hsl(var(--foreground))]">
                {t('prerequisites.claudeOptionalLink')}
              </span>{' '}
              {t('prerequisites.claudeOptionalSuffix')}
            </p>
          </div>
        </div>
      )}

      {/* Required dependency missing hint */}
      {phase === 'done' && result && !result.canProceed && (
        <div className="flex items-start gap-2.5 rounded-lg bg-red-500/5 border border-red-500/10 px-4 py-3 mb-6">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
          <div className="text-xs text-[hsl(var(--muted-foreground))] text-left space-y-2">
            <p>
              <strong className="text-[hsl(var(--foreground))]">
                {t('prerequisites.requiredMissingTitle')}
              </strong>{' '}
              {t('prerequisites.requiredMissingDesc')}
            </p>
            <a
              href="https://nodejs.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:opacity-80 transition-opacity font-medium"
            >
              {t('prerequisites.downloadNodejs')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {phase === 'done' && result && (
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label={t('common.back')}
          >
            {t('common.back')}
          </button>
          <div className="flex items-center gap-3">
            {!result.canProceed && (
              <button
                onClick={() => void handleRecheck()}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-[hsl(var(--border))] text-sm font-medium hover:bg-[hsl(var(--accent))] transition-colors"
                aria-label={t('prerequisites.recheck')}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('prerequisites.recheck')}
              </button>
            )}
            <button
              onClick={onContinue}
              disabled={!result.canProceed}
              className="px-5 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={t('common.continue')}
            >
              {t('common.continue')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
