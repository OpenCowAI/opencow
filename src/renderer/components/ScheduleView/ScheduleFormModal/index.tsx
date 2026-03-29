// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Clock, Pencil } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { cn } from '@/lib/utils'
import { useScheduleForm, buildScheduleInput, type ScheduleFormDefaultValues } from './useScheduleForm'
import { TriggerSection } from './TriggerSection'
import { ActionSection } from './ActionSection'
import type { Schedule } from '@shared/types'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

interface ScheduleFormModalProps {
  onClose: () => void
  /** When provided, the modal opens in edit mode pre-filled with this schedule. */
  editSchedule?: Schedule
  /** Pre-fill values without a full Schedule entity (e.g. from AI Creator). */
  defaultValues?: ScheduleFormDefaultValues
  /** Called after a schedule is successfully created (not in edit mode). */
  onCreated?: (schedule: Schedule) => void
  /** Custom z-index when layered above another modal (e.g. AI Creator). */
  zIndex?: number
}

// ---------------------------------------------------------------------------
// ScheduleFormModal
// ---------------------------------------------------------------------------

export function ScheduleFormModal({ onClose, editSchedule, defaultValues, onCreated, zIndex }: ScheduleFormModalProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const isEditMode = !!editSchedule

  const { phase, requestClose } = useExitAnimation(onClose)
  const { state, dispatch, canSubmit } = useScheduleForm(editSchedule, defaultValues)

  // Description field: show expanded immediately when editing or when defaultValues provide a description
  const [descOpen, setDescOpen] = useState(
    (isEditMode && !!editSchedule.description) || !!defaultValues?.description
  )
  const descRef = useRef<HTMLTextAreaElement>(null)
  // Track whether the user just clicked "Add description" so we auto-focus only once
  const shouldFocusDesc = useRef(false)

  const descRefCallback = useCallback((el: HTMLTextAreaElement | null) => {
    (descRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    if (el && shouldFocusDesc.current) {
      el.focus()
      shouldFocusDesc.current = false
    }
  }, [])

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit) return
    dispatch({ type: 'SET_SAVING', payload: true })
    dispatch({ type: 'SET_ERROR', payload: null })
    try {
      if (isEditMode) {
        // Edit mode: patch the existing schedule; stay on the detail view
        await useScheduleStore.getState().updateSchedule(editSchedule.id, buildScheduleInput(state))
      } else {
        // Create mode: create new and navigate to its detail
        const created = await useScheduleStore.getState().createSchedule(buildScheduleInput(state))
        if (onCreated) {
          onCreated(created)
        } else {
          useAppStore.getState().openDetail({ type: 'schedule', scheduleId: created.id })
        }
      }
      requestClose()
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        payload: err instanceof Error
          ? err.message
          : isEditMode ? 'Failed to update schedule' : 'Failed to create schedule',
      })
    } finally {
      dispatch({ type: 'SET_SAVING', payload: false })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      className={cn('fixed inset-0 flex items-center justify-center overscroll-contain no-drag', zIndex ? '' : 'z-50')}
      style={zIndex ? { zIndex } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={isEditMode ? `Edit schedule: ${editSchedule.name}` : 'Create new schedule'}
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit'  && 'modal-overlay-exit'
        )}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        className={cn(
          'relative z-10 bg-[hsl(var(--background))] border border-[hsl(var(--border))]',
          'rounded-2xl shadow-xl w-full max-w-[600px] mx-4 flex flex-col max-h-[90vh] overflow-hidden',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit'  && 'modal-content-exit'
        )}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2">
            {isEditMode
              ? <Pencil className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              : <Clock   className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            }
            <h2 className="text-sm font-semibold">
              {isEditMode ? t('form.editTitle') : t('form.newTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {t('form.nameLabel')} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={state.name}
              onChange={(e) => dispatch({ type: 'SET_NAME', payload: e.target.value })}
              placeholder={t('form.namePlaceholder')}
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-xl border border-[hsl(var(--border))] bg-transparent placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
            />
          </div>

          {/* Description — expand-on-click (Linear / Notion pattern) */}
          {descOpen ? (
            <textarea
              value={state.description}
              onChange={(e) => dispatch({ type: 'SET_DESCRIPTION', payload: e.target.value })}
              onBlur={() => { if (!state.description.trim()) setDescOpen(false) }}
              placeholder={t('form.descriptionPlaceholder')}
              rows={2}
              className={cn(
                'w-full px-0 py-0 text-xs bg-transparent resize-none',
                'text-[hsl(var(--muted-foreground))] placeholder:text-[hsl(var(--muted-foreground)/0.4)]',
                'focus:outline-none focus:text-[hsl(var(--foreground))]',
                '-mt-3'
              )}
              ref={descRefCallback}
            />
          ) : (
            <button
              type="button"
              onClick={() => { shouldFocusDesc.current = true; setDescOpen(true) }}
              className="text-xs text-[hsl(var(--muted-foreground)/0.45)] hover:text-[hsl(var(--muted-foreground))] transition-colors text-left -mt-3"
            >
              {state.description.trim() || t('form.addDescription')}
            </button>
          )}

          {/* Trigger */}
          <TriggerSection
            triggerMode={state.triggerMode}
            timeTrigger={state.timeTrigger}
            eventMatcherType={state.eventTrigger.matcherType}
            dispatch={dispatch}
          />

          {/* Action */}
          <ActionSection
            action={state.action}
            projectId={state.projectId}
            dispatch={dispatch}
          />
        </div>

        {/* ── Footer (P0: inline error) ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-[hsl(var(--border))]">
          {/* Error message */}
          {state.error && (
            <p className="flex-1 text-xs text-red-500 truncate" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={requestClose}
              className="px-3 py-1.5 text-xs rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
            >
              {t('common:cancel')}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              title={canSubmit ? '⌘ Enter' : t('form.enterNameToContinue')}
              className={cn(
                'px-4 py-1.5 text-xs rounded-lg font-medium transition-colors',
                canSubmit
                  ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary)/0.88)]'
                  : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] cursor-not-allowed'
              )}
            >
              {state.saving
                ? (isEditMode ? t('form.saving')  : t('form.creating'))
                : (isEditMode ? t('form.saveChanges') : t('form.createSchedule'))
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
