// SPDX-License-Identifier: Apache-2.0

/**
 * DoneStep — Final onboarding step showing summary and next-actions.
 *
 * Design decisions:
 *   - Pure presentational: receives all cross-step state via props from
 *     OnboardingModal (orchestrator pattern). Does NOT read from stores.
 *   - `providerConfigured` prop replaces the previous direct store read,
 *     keeping data flow explicit and testable.
 */

import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Settings } from 'lucide-react'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

interface DoneStepProps {
  stepConfig: StepConfig
  claudeCodeAvailable: boolean
  /** Whether the user completed provider auth during onboarding (from orchestrator). */
  providerConfigured: boolean
  onComplete: () => void
}

export function DoneStep({
  stepConfig,
  claudeCodeAvailable,
  providerConfigured,
  onComplete
}: DoneStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')

  return (
    <div className="onboarding-step-enter flex max-h-[calc(100vh-7rem)] flex-col text-center">
      <div className="shrink-0">
        <StepIndicator {...stepConfig} />
      </div>

      <div data-testid="onboarding-scroll-content" className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-3 pb-1">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>

          <h2 className="text-xl font-bold mb-1.5">{t('done.title')}</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
            {claudeCodeAvailable ? t('done.subtitleWithClaude') : t('done.subtitleWithoutClaude')}
          </p>

          {/* Provider not configured warning */}
          {!providerConfigured && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 mb-4 flex items-start gap-2.5 text-left">
              <AlertTriangle
                className="h-4 w-4 text-amber-500 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('done.providerNotConfigured')}
              </p>
            </div>
          )}

          {/* Summary card */}
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 mb-6 text-left">
            <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
              {t('done.whatsNext')}
            </p>
            <div className="space-y-3">
              {claudeCodeAvailable ? (
                <>
                  <StepRow number={1}>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {t('done.withClaude.step1Prefix')}{' '}
                      <code className="text-xs bg-[hsl(var(--muted))] px-1 py-0.5 rounded font-mono">
                        {t('done.withClaude.step1Command')}
                      </code>{' '}
                      {t('done.withClaude.step1Suffix')}
                    </p>
                  </StepRow>
                  <StepRow number={2}>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {t('done.withClaude.step2')}
                    </p>
                  </StepRow>
                  <StepRow number={3}>
                    <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                      <span>{t('done.withClaude.step3Prefix')}</span>
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--foreground))] font-medium">
                        <Settings className="h-3 w-3" />
                        {t('done.withClaude.step3Link')}
                      </span>
                    </div>
                  </StepRow>
                </>
              ) : (
                <>
                  <StepRow number={1}>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {t('done.withoutClaude.step1Prefix')}{' '}
                      <a
                        href="https://opencow.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[hsl(var(--primary))] hover:opacity-80 transition-opacity font-medium"
                      >
                        {t('done.withoutClaude.step1Link')}
                      </a>{' '}
                      {t('done.withoutClaude.step1Suffix')}
                    </p>
                  </StepRow>
                  <StepRow number={2}>
                    <div className="flex items-center gap-1.5 text-sm text-[hsl(var(--muted-foreground))]">
                      <span>{t('done.withoutClaude.step2Prefix')}</span>
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--foreground))] font-medium">
                        <Settings className="h-3 w-3" />
                        {t('done.withoutClaude.step2Link')}
                      </span>
                    </div>
                  </StepRow>
                  <StepRow number={3}>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {t('done.withoutClaude.step3')}
                    </p>
                  </StepRow>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 pt-6">
        <button
          onClick={onComplete}
          className="px-6 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity"
          aria-label={t('done.openApp')}
        >
          {t('done.openApp')}
        </button>
      </div>
    </div>
  )
}

/** Numbered step row for the "What's Next" card */
function StepRow({
  number,
  children
}: {
  number: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--accent))] text-xs font-bold text-[hsl(var(--primary))]">
        {number}
      </div>
      {children}
    </div>
  )
}
