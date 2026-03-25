// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderPlus,
  FileEdit,
  Webhook,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react'
import { StepIndicator } from './StepIndicator'
import type { StepConfig } from './types'

/** Hook event names — static, language-independent identifiers. */
const HOOK_EVENT_NAMES = [
  'SessionStart',
  'Stop',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'TaskCompleted',
  'SubagentStart',
  'SubagentStop',
] as const

interface DisclosureStepProps {
  stepConfig: StepConfig
  onSkip: () => void
  onContinue: () => void
}

export function DisclosureStep({
  stepConfig,
  onSkip,
  onContinue,
}: DisclosureStepProps): React.JSX.Element {
  const { t } = useTranslation('onboarding')
  const [hooksExpanded, setHooksExpanded] = useState(false)

  return (
    <div className="onboarding-step-enter">
      <StepIndicator {...stepConfig} />

      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-1.5">{t('disclosure.title')}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {t('disclosure.subtitle')}
        </p>
      </div>

      <div className="space-y-3 mb-6">
        {/* What we create */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <FolderPlus className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium">{t('disclosure.newFilesCreated')}</span>
          </div>
          <div className="space-y-2 ml-[26px]">
            <div className="flex items-start gap-2">
              <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs font-mono break-all">
                ~/.opencow/
              </code>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('disclosure.opencowDirDesc')}
            </p>
            <div className="flex items-start gap-2">
              <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs font-mono break-all">
                ~/.opencow/hooks/event-logger.sh
              </code>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('disclosure.eventLoggerDesc')}
            </p>
          </div>
        </div>

        {/* What we modify */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <FileEdit className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">{t('disclosure.configModified')}</span>
          </div>
          <div className="space-y-2 ml-[26px]">
            <div className="flex items-start gap-2">
              <code className="rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-xs font-mono break-all">
                ~/.claude/settings.json
              </code>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('disclosure.settingsJsonDesc')}{' '}
              <strong>{t('disclosure.settingsJsonNot')}</strong>{' '}
              {t('disclosure.settingsJsonSuffix')}
            </p>
          </div>
        </div>

        {/* Hooks registered */}
        <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
          <button
            onClick={() => setHooksExpanded(!hooksExpanded)}
            className="flex w-full items-center justify-between"
            aria-expanded={hooksExpanded}
            aria-label="Toggle hook events list"
          >
            <div className="flex items-center gap-2.5">
              <Webhook className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium">
                {t('disclosure.hookEventsRegistered', { count: HOOK_EVENT_NAMES.length })}
              </span>
            </div>
            {hooksExpanded ? (
              <ChevronUp className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            )}
          </button>
          {hooksExpanded && (
            <div className="mt-3 ml-[26px] space-y-1.5">
              {HOOK_EVENT_NAMES.map((name) => (
                <div key={name} className="flex items-baseline gap-2">
                  <code className="rounded bg-[hsl(var(--muted))] px-1 py-0.5 text-[11px] font-mono shrink-0">
                    {name}
                  </code>
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {t(`disclosure.hookEvents.${name}`)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Safety notice */}
      <div className="flex items-start gap-2.5 rounded-lg bg-[hsl(var(--accent))] px-4 py-3 mb-6">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
        <div className="text-xs text-[hsl(var(--muted-foreground))] text-left space-y-1">
          <p>
            <strong className="text-[hsl(var(--foreground))]">
              {t('disclosure.safeReversibleTitle')}
            </strong>{' '}
            {t('disclosure.safeReversibleDesc')}{' '}
            <span className="font-medium text-[hsl(var(--foreground))]">
              {t('disclosure.safeReversibleLink')}
            </span>{' '}
            {t('disclosure.safeReversibleSuffix')}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          aria-label={t('common.skipForNow')}
        >
          {t('common.skipForNow')}
        </button>
        <button
          onClick={onContinue}
          className="px-5 py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-medium text-sm hover:opacity-90 transition-opacity"
          aria-label={t('common.continue')}
        >
          {t('common.continue')}
        </button>
      </div>
    </div>
  )
}
