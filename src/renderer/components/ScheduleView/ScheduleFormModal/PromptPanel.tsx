// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { CONTEXT_INJECTION_OPTIONS } from './constants'
import { InfoTooltip } from './InfoTooltip'
import type { FormAction, FormState } from './useScheduleForm'

// ---------------------------------------------------------------------------
// PromptPanel — right-column editor for the prompts that get sent to the agent.
// ---------------------------------------------------------------------------

/** Min / max heights (px) for the user-question textarea. */
const PROMPT_MIN_H = 320
const PROMPT_MAX_H = 600

type PromptTab = 'user' | 'system'

interface PromptPanelProps {
  action: FormState['action']
  dispatch: React.Dispatch<FormAction>
}

export function PromptPanel({ action, dispatch }: PromptPanelProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const [tab, setTab] = useState<PromptTab>('user')
  const [showInjections, setShowInjections] = useState(
    action.contextInjections.length > 0
  )

  // Auto-grow user-question textarea. Both tab panels stay mounted (forceMount)
  // so refs and typed-but-not-yet-saved drafts survive tab switches.
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const autoGrow = useCallback(() => {
    const el = promptRef.current
    // Hidden textareas report scrollHeight=0 — skip until the tab is visible.
    if (!el || el.offsetParent === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, PROMPT_MIN_H), PROMPT_MAX_H)}px`
  }, [])

  // Recompute on hydration changes AND when the user tab becomes active again.
  useEffect(autoGrow, [action.promptTemplate, tab, autoGrow])

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as PromptTab)}>
        {/* ── Segmented-control tab strip, matching the trigger-mode toggle ── */}
        <TabsList
          ariaLabel={t('action.promptTabsAria')}
          className="inline-flex items-center gap-1 p-1 rounded-lg bg-[hsl(var(--muted)/0.4)] w-fit"
        >
          <PromptTabTrigger value="user">{t('action.promptTemplate')}</PromptTabTrigger>
          <PromptTabTrigger value="system">
            {t('action.systemPrompt')}
            <span className="ml-1 font-normal text-[hsl(var(--muted-foreground)/0.7)]">
              {t('action.systemPromptOptional')}
            </span>
          </PromptTabTrigger>
        </TabsList>

        {/* ── User question (prompt template) ── */}
        <TabsContent value="user" forceMount className="pt-3 space-y-1.5">
          <textarea
            ref={promptRef}
            value={action.promptTemplate}
            onChange={(e) => {
              dispatch({ type: 'SET_PROMPT', payload: e.target.value })
              autoGrow()
            }}
            rows={12}
            className="w-full px-3 py-2 text-xs rounded-xl border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground)/0.4)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-none font-mono leading-relaxed overflow-y-auto"
            style={{ minHeight: PROMPT_MIN_H, maxHeight: PROMPT_MAX_H }}
          />
          <p className="text-[11px] text-[hsl(var(--muted-foreground)/0.7)] px-0.5">
            {t('action.variableHint')}
          </p>
        </TabsContent>

        {/* ── System prompt (optional) ── */}
        <TabsContent value="system" forceMount className="pt-3">
          <textarea
            value={action.systemPrompt}
            onChange={(e) => dispatch({ type: 'SET_SYSTEM_PROMPT', payload: e.target.value })}
            rows={14}
            className="w-full px-3 py-2 text-xs rounded-xl border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground)/0.4)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-y leading-relaxed"
            placeholder={t('action.systemPromptPlaceholder')}
            style={{ minHeight: PROMPT_MIN_H }}
          />
        </TabsContent>
      </Tabs>

      {/* Context injections — collapsible card */}
      <div className="rounded-xl border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--muted)/0.12)]">
        <button
          type="button"
          onClick={() => setShowInjections((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium text-[hsl(var(--muted-foreground))]">
            {t('form.contextInjections')}
            <InfoTooltip
              align="start"
              content={t('tooltips.contextInjections')}
            />
            {action.contextInjections.length > 0 && (
              <span className="text-[10px] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] rounded-full px-1.5 py-0.5">
                {action.contextInjections.length} {t('form.selected')}
              </span>
            )}
          </span>
          {showInjections
            ? <ChevronUp   className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
            : <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
          }
        </button>

        {showInjections && (
          <div className="px-3 pb-3 pt-1 border-t border-[hsl(var(--border)/0.4)] flex flex-wrap gap-1.5">
            {CONTEXT_INJECTION_OPTIONS.map((opt) => {
              const active = action.contextInjections.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => dispatch({ type: 'TOGGLE_INJECTION', payload: opt.value })}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border transition-colors',
                    active
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))] font-medium'
                      : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border)/0.8)]'
                  )}
                >
                  {t(opt.labelKey)}
                  <InfoTooltip content={t(opt.tooltipKey)} />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PromptTabTrigger — segmented-control pill, matches the trigger-mode toggle.
// ---------------------------------------------------------------------------

function PromptTabTrigger({
  value,
  children,
}: {
  value: PromptTab
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <TabsTrigger
      value={value}
      className="px-3 py-1.5 text-xs rounded-md font-medium transition-colors focus:outline-none"
      activeClassName="bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm"
      inactiveClassName="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
    >
      {children}
    </TabsTrigger>
  )
}
