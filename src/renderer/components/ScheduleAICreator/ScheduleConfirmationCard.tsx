// SPDX-License-Identifier: Apache-2.0

/**
 * ScheduleConfirmationCard — In-conversation preview card for AI-generated schedules.
 *
 * A read-only preview of the parsed schedule output within the chat flow.
 * Supports a 4-state lifecycle:
 *   - preview:   Read-only display with Create / Edit / Discard actions
 *   - creating:  API call in flight (spinner, disabled actions)
 *   - created:   Success state (green check, "View" link)
 *   - discarded: Collapsed strike-through state
 *
 * Editing is delegated to `ScheduleFormModal` (opened by the parent via `onEdit`),
 * ensuring full feature parity with the standard schedule creation flow.
 *
 * @module
 */

import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Pencil, Trash2, ExternalLink, CalendarClock } from 'lucide-react'
import { formatParsedFrequency } from '@/lib/scheduleFormatters'
import { SCHEDULE_PRIORITY_THEME } from '@/constants/schedulePriority'
import { cn } from '@/lib/utils'
import type { Schedule } from '@shared/types'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'

// ─── Types ───────────────────────────────────────────────────────────────────

type CardState = 'preview' | 'creating' | 'created' | 'discarded'

export interface ScheduleConfirmationCardProps {
  /** The AI-parsed schedule data */
  schedule: ParsedScheduleOutput
  /** Called when user confirms creation. Returns the created Schedule. */
  onConfirm: (schedule: ParsedScheduleOutput) => Promise<Schedule>
  /** Called when user discards the schedule */
  onDiscard?: () => void
  /** Called after successful creation to navigate to the schedule detail */
  onNavigate?: (scheduleId: string) => void
  /** Called when user wants to edit — parent opens ScheduleFormModal. */
  onEdit?: (schedule: ParsedScheduleOutput) => void
  /**
   * Externally-created schedule — set by the parent when the schedule was created
   * via ScheduleFormModal (Edit flow) rather than the card's own Create button.
   */
  createdSchedule?: Schedule | null
}

// ─── Component ──────────────────────────────────────────────────────────────

export const ScheduleConfirmationCard = memo(function ScheduleConfirmationCard({
  schedule,
  onConfirm,
  onDiscard,
  onNavigate,
  onEdit,
  createdSchedule: externalCreatedSchedule
}: ScheduleConfirmationCardProps): React.JSX.Element {
  const { t } = useTranslation('schedule')

  const [cardState, setCardState] = useState<CardState>('preview')
  const [internalCreatedSchedule, setInternalCreatedSchedule] = useState<Schedule | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Merge internal + external created schedule (external comes from ScheduleFormModal flow)
  const createdSchedule = externalCreatedSchedule ?? internalCreatedSchedule
  const isCreated = cardState === 'created' || !!externalCreatedSchedule
  const isCreating = cardState === 'creating'
  const isDiscarded = cardState === 'discarded'

  // ── Actions ────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setCardState('creating')
    setError(null)
    try {
      const created = await onConfirm(schedule)
      setInternalCreatedSchedule(created)
      setCardState('created')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiCreator.card.createFailed'))
      setCardState('preview')
    }
  }, [schedule, onConfirm, t])

  const handleDiscard = useCallback(() => {
    setCardState('discarded')
    onDiscard?.()
  }, [onDiscard])

  const handleEdit = useCallback(() => {
    onEdit?.(schedule)
  }, [onEdit, schedule])

  // ── Derived ────────────────────────────────────────────────────

  const frequencySummary = formatParsedFrequency(schedule, t)
  const priorityTheme = SCHEDULE_PRIORITY_THEME[schedule.priority] ?? SCHEDULE_PRIORITY_THEME.normal

  // ── Render: Discarded ──────────────────────────────────────────

  if (isDiscarded) {
    return (
      <div className="ml-4 mt-2 max-w-md rounded-xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.5)] p-3 opacity-50">
        <span className="text-xs text-[hsl(var(--muted-foreground))] line-through">
          {schedule.name}
        </span>
        <span className="ml-2 text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic">
          {t('aiCreator.card.discarded')}
        </span>
      </div>
    )
  }

  // ── Render: Main card ──────────────────────────────────────────

  return (
    <div
      className={cn(
        'ml-4 mt-2 max-w-md rounded-xl border overflow-hidden transition-colors',
        isCreated
          ? 'border-green-500/30 bg-[hsl(var(--card))]'
          : 'border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))]'
      )}
      role="region"
      aria-label={t('aiCreator.card.confirmationAria')}
    >
      {/* ── Frequency + Priority row ────────────────────────────── */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {frequencySummary}
          </span>
        </div>
        <span className={cn('text-[10px] font-medium', priorityTheme.color)}>
          {t(`priority.${schedule.priority}`)}
        </span>
      </div>

      {/* ── Name ────────────────────────────────────────────────── */}
      <div className="px-3 pb-1.5">
        <h4 className={cn(
          'text-sm font-medium truncate',
          isCreated
            ? 'text-green-600 dark:text-green-400'
            : 'text-[hsl(var(--foreground))]'
        )}>
          {isCreated && <Check className="w-3.5 h-3.5 inline mr-1" aria-hidden />}
          {schedule.name}
        </h4>
      </div>

      {/* ── Description ────────────────────────────────────────── */}
      {schedule.description && (
        <div className="px-3 pb-1.5">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
            {schedule.description}
          </p>
        </div>
      )}

      {/* ── Prompt preview ─────────────────────────────────────── */}
      {schedule.prompt && (
        <div className="relative border-t border-[hsl(var(--border)/0.3)]">
          <div className="px-3 py-2 max-h-20 overflow-hidden text-xs text-[hsl(var(--muted-foreground))] leading-relaxed whitespace-pre-wrap">
            {schedule.prompt}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent" />
        </div>
      )}

      {/* ── Error message ──────────────────────────────────────── */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-red-500 border-t border-[hsl(var(--border)/0.3)]">
          {error}
        </div>
      )}

      {/* ── Actions footer ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-[hsl(var(--border)/0.3)]">
        {/* Left: Edit / View */}
        <div>
          {isCreated ? (
            <button
              onClick={() => createdSchedule && onNavigate?.(createdSchedule.id)}
              className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline"
            >
              <ExternalLink className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.view')}
            </button>
          ) : (
            <button
              onClick={handleEdit}
              disabled={isCreating || !onEdit}
              className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Pencil className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.editFields')}
            </button>
          )}
        </div>

        {/* Right: Discard + Create */}
        {!isCreated && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleDiscard}
              disabled={isCreating}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={t('aiCreator.card.discardAria')}
            >
              <Trash2 className="w-3 h-3" aria-hidden />
              {t('aiCreator.card.discard')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={isCreating || !schedule.name.trim()}
              className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              aria-label={t('aiCreator.card.createAria')}
            >
              {isCreating ? (
                <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Check className="w-3 h-3" aria-hidden />
              )}
              {isCreating ? t('aiCreator.card.creating') : t('aiCreator.card.create')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
