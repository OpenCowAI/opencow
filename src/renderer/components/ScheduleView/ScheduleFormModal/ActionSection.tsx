// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Info, Check } from 'lucide-react'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
import { cn } from '@/lib/utils'
import { ACTION_OPTIONS, CONTEXT_INJECTION_OPTIONS } from './constants'
import type { FormAction, FormState } from './useScheduleForm'
import type { ActionType } from '@shared/types'

// ---------------------------------------------------------------------------
// InfoTooltip — CSS group-hover, no JS state needed
// ---------------------------------------------------------------------------

/**
 * Renders an ⓘ icon that reveals a tooltip card on hover.
 *
 * `align`:
 *   - "center" (default) — tooltip is centred on the icon; use for mid-page icons
 *   - "start"            — tooltip left-edge aligns with the icon; opens rightward;
 *                          use when the icon is near the left edge of the container
 *   - "end"              — tooltip right-edge aligns with the icon; opens leftward;
 *                          use when the icon is near the right edge
 */
function InfoTooltip({
  content,
  align = 'center',
}: {
  content: string
  align?: 'center' | 'start' | 'end'
}): React.JSX.Element {
  const cardPos =
    align === 'start' ? 'left-0' :
    align === 'end'   ? 'right-0' :
    'left-1/2 -translate-x-1/2'

  const arrowPos =
    align === 'start' ? 'left-3' :
    align === 'end'   ? 'right-3' :
    'left-1/2 -translate-x-1/2'

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className="relative group/tip inline-flex items-center"
    >
      <Info className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.5)] group-hover/tip:text-[hsl(var(--muted-foreground))] transition-colors cursor-help shrink-0" />

      {/* Tooltip card */}
      <span
        role="tooltip"
        className={[
          `pointer-events-none absolute bottom-full ${cardPos} mb-2 z-50`,
          'hidden group-hover/tip:block',
          'w-56 p-2.5 rounded-lg shadow-lg',
          'bg-[hsl(var(--popover))] border border-[hsl(var(--border))]',
          'text-left text-[11px] leading-relaxed text-[hsl(var(--foreground))] whitespace-pre-line',
        ].join(' ')}
      >
        {content}
        {/* Arrow */}
        <span className={`absolute top-full ${arrowPos} border-4 border-transparent border-t-[hsl(var(--border))]`} />
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// ActionTypeDropdown — compact pill matching ProjectPicker's trigger style
// ---------------------------------------------------------------------------

// Dropdown anchor coords captured at open time (fixed positioning bypasses
// all overflow:hidden / overflow:auto clipping on modal ancestors)
interface DropPos { left: number; bottom: number; minWidth: number }

const DROPDOWN_ANIM_MS = 100

function ActionTypeDropdown({
  value,
  onChange,
}: {
  value: ActionType
  onChange: (t: ActionType) => void
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const [open, setOpen]         = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [dropPos, setDropPos]   = useState<DropPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selected = ACTION_OPTIONS.find((o) => o.value === value) ?? ACTION_OPTIONS[0]!

  const closeDropdown = useCallback((): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setIsClosing(true)
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setIsClosing(false)
      setDropPos(null)
    }, DROPDOWN_ANIM_MS)
  }, [])

  const handleToggle = (): void => {
    if (open || isClosing) {
      closeDropdown()
      return
    }
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      // Open upward — action section sits near the bottom of the modal
      setDropPos({
        left: r.left,
        bottom: window.innerHeight - r.top + 4,
        minWidth: Math.max(r.width, 240),
      })
    }
    setOpen(true)
  }

  return (
    <div>
      {/* Trigger — same visual language as ProjectPicker */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-[hsl(var(--border))] transition-colors',
          'hover:bg-[hsl(var(--foreground)/0.04)]',
          'focus:outline-none',
          open && !isClosing && 'ring-1 ring-[hsl(var(--ring))]',
        )}
      >
        <span>{t(selected.labelKey)}</span>
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 transition-transform', open && !isClosing && 'rotate-180')}
        />
      </button>

      {/* Dropdown — rendered with fixed positioning so modal overflow never clips it.
          Stays mounted during isClosing so the exit animation can play. */}
      {(open || isClosing) && dropPos && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-[199]" onClick={closeDropdown} aria-hidden="true" />

          <div
            role="listbox"
            className={cn(
              'fixed z-[200] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg overflow-hidden py-1',
              isClosing ? 'dropdown-exit' : 'dropdown-enter',
            )}
            style={{ left: dropPos.left, bottom: dropPos.bottom, minWidth: dropPos.minWidth }}
          >
            {ACTION_OPTIONS.map((opt) => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => { onChange(opt.value); closeDropdown() }}
                  className={cn(
                    'w-full text-left px-3 py-2 text-xs transition-colors flex items-start justify-between gap-3',
                    isSelected
                      ? 'bg-[hsl(var(--primary)/0.06)]'
                      : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                  )}
                >
                  <div className="min-w-0">
                    <div className={cn(
                      'font-medium leading-tight',
                      isSelected ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'
                    )}>
                      {t(opt.labelKey)}
                    </div>
                    <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">
                      {t(opt.descriptionKey)}
                    </div>
                  </div>
                  <Check className={cn(
                    'h-3 w-3 shrink-0 mt-0.5',
                    isSelected ? 'text-[hsl(var(--primary))] opacity-100' : 'opacity-0'
                  )} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActionSection
// ---------------------------------------------------------------------------

interface ActionSectionProps {
  action: FormState['action']
  projectId: string | null
  dispatch: React.Dispatch<FormAction>
}

export function ActionSection({
  action,
  projectId,
  dispatch,
}: ActionSectionProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const showSessionConfig =
    action.type === 'start_session' || action.type === 'resume_session'

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))]">
        Action
      </label>

      {/* ── Unified action card ── */}
      <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-3 space-y-3">

        {/* Type picker row — same layout as Project row below */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 w-14">
            {t('action.typeLabel')}
          </span>
          <ActionTypeDropdown
            value={action.type}
            onChange={(t) => dispatch({ type: 'SET_ACTION_TYPE', payload: t })}
          />
        </div>

        {/* Project picker row */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] shrink-0 w-14">
            {t('action.projectLabel')}
            <InfoTooltip
              align="start"
              content={'Specify the project associated with this Schedule.\n\nOnce selected:\n· The Agent will execute within the project directory\n· Context injections (e.g. Git changes, Issue list) will be automatically scoped to this project\n· Leave unselected for a global task with no project context'}
            />
          </span>
          <ProjectPicker
            value={projectId}
            onChange={(id) => dispatch({ type: 'SET_PROJECT', payload: id })}
            placeholder={t('action.anyProject')}
            ariaLabel={t('action.selectProject')}
            triggerClassName="py-1.5 px-2.5 text-xs"
            position="above"
          />
        </div>

        {/* Session-specific config (start_session / resume_session) */}
        {showSessionConfig && (
          <>
            <div className="border-t border-[hsl(var(--border)/0.5)]" />
            <SessionActionConfig action={action} dispatch={dispatch} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SessionActionConfig
// ---------------------------------------------------------------------------

function SessionActionConfig({
  action,
  dispatch,
}: {
  action: FormState['action']
  dispatch: React.Dispatch<FormAction>
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const [showInjections, setShowInjections] = useState(
    action.contextInjections.length > 0
  )

  return (
    <div className="space-y-3">
      {/* Prompt template */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
          {t('action.promptTemplate')}
          <span className="ml-1.5 font-normal text-[hsl(var(--muted-foreground)/0.6)]">
            {t('action.variableHint')}
          </span>
        </label>
        <textarea
          value={action.promptTemplate}
          onChange={(e) => dispatch({ type: 'SET_PROMPT', payload: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 text-xs rounded-xl border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground)/0.4)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-none font-mono leading-relaxed"
        />
      </div>

      {/* Context injections — collapsible */}
      <div className="rounded-xl border border-[hsl(var(--border)/0.5)]">
        <button
          type="button"
          onClick={() => setShowInjections((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-xl hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium text-[hsl(var(--muted-foreground))]">
            {t('form.contextInjections')}
            <InfoTooltip
              align="start"
              content={'Before running the Agent, automatically append selected project information to the end of the Prompt.\n\nThis allows the Agent to provide more precise analysis based on the actual state of the project, rather than generic responses.'}
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
                  <InfoTooltip content={opt.tooltip} />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
