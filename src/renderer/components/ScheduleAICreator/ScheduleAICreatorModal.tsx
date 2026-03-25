// SPDX-License-Identifier: Apache-2.0

/**
 * ScheduleAICreatorModal — Centered modal for conversational schedule creation.
 *
 * Composes:
 *   - `CreatorModalControlled` for the full modal layout and lifecycle
 *   - `useScheduleCreatorSession` for domain-specific session management
 *   - `useCreatorModalBehavior` for modal behavior (needs `markConfirmed`)
 *
 * Domain-specific concerns only:
 *   - `ScheduleConfirmationCard` footer for create/edit/navigate
 *   - `ScheduleFormModal` for full-featured editing
 *   - Schedule creation via `createSchedule` store action
 *   - Mapping helpers (ParsedScheduleOutput → CreateScheduleInput / FormDefaults)
 *
 * @module
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScheduleConfirmationCard } from './ScheduleConfirmationCard'
import { ScheduleFormModal } from '../ScheduleView/ScheduleFormModal'
import { CreatorModalControlled, type CreatorModalI18n } from '../AICreator'
import {
  useScheduleCreatorSession,
  type ScheduleCreatorSessionConfig
} from '@/hooks/useScheduleCreatorSession'
import { useCreatorModalBehavior } from '@/hooks/useCreatorModalBehavior'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { toast } from '@/lib/toast'
import type {
  Schedule,
  CreateScheduleInput
} from '@shared/types'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import type { ScheduleFormDefaultValues } from '../ScheduleView/ScheduleFormModal/useScheduleForm'

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Derive a stable identity key from parsed schedule output for discard-guard comparison. */
function scheduleOutputKey(p: ParsedScheduleOutput | null): string | null {
  if (!p) return null
  return `${p.name}\0${p.frequency}\0${p.prompt.slice(0, 100)}`
}

// ═══════════════════════════════════════════════════════════════════
// Mapping helpers
// ═══════════════════════════════════════════════════════════════════

/** ParsedScheduleOutput → ScheduleFormDefaultValues (Edit flow) */
function toFormDefaults(
  parsed: ParsedScheduleOutput,
  projectId?: string | null
): ScheduleFormDefaultValues {
  return {
    name: parsed.name,
    description: parsed.description,
    projectId: projectId ?? null,
    triggerMode: 'time',
    timeTrigger: {
      freqType: parsed.frequency,
      timeOfDay: parsed.timeOfDay ?? '09:00',
      intervalMinutes: parsed.intervalMinutes ?? 60,
      daysOfWeek: parsed.daysOfWeek ?? [1, 2, 3, 4, 5],
      cronExpression: parsed.cronExpression ?? '',
      executeAt: parsed.executeAt ?? '',
    },
    action: {
      type: 'start_session',
      promptTemplate: parsed.prompt,
    },
  }
}

/** ParsedScheduleOutput → CreateScheduleInput (Direct create flow) */
function toCreateScheduleInput(
  parsed: ParsedScheduleOutput,
  projectId?: string | null
): CreateScheduleInput {
  return {
    name: parsed.name,
    description: parsed.description || undefined,
    trigger: {
      time: {
        type: parsed.frequency,
        workMode: 'all_days',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeOfDay: parsed.timeOfDay,
        intervalMinutes: parsed.intervalMinutes,
        daysOfWeek: parsed.daysOfWeek,
        cronExpression: parsed.cronExpression,
        executeAt: parsed.executeAt ? new Date(parsed.executeAt).getTime() : undefined,
      },
    },
    action: {
      type: 'start_session',
      session: { promptTemplate: parsed.prompt },
      projectId: projectId ?? undefined,
    },
    priority: parsed.priority || 'normal',
  }
}

// ═══════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════

export interface ScheduleAICreatorModalProps {
  /** Controls modal visibility. */
  open: boolean
  /** Called when the modal should close. */
  onClose: () => void
  /** Configuration for the schedule creator session. */
  config?: ScheduleCreatorSessionConfig
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export function ScheduleAICreatorModal({
  open,
  onClose,
  config = {}
}: ScheduleAICreatorModalProps): React.JSX.Element | null {
  const { t } = useTranslation('schedule')
  const createSchedule = useScheduleStore((s) => s.createSchedule)
  const projectId = useAppStore(selectProjectId)
  const projects = useAppStore((s) => s.projects)
  const openDetail = useAppStore((s) => s.openDetail)

  // ── Session config — merge props with current project context ──
  const sessionConfig: ScheduleCreatorSessionConfig = useMemo(
    () => ({
      projectId: config.projectId ?? projectId,
    }),
    [config.projectId, projectId]
  )

  // ── Resolve project context ────────────────────────────────────
  const project = useMemo(
    () => {
      const id = sessionConfig.projectId
      const path = id ? projects.find((p) => p.id === id)?.path : undefined
      return { id: id ?? undefined, path }
    },
    [projects, sessionConfig.projectId]
  )

  const creator = useScheduleCreatorSession(sessionConfig)

  // ── Modal behavior (needs markConfirmed for create/edit flows) ─
  const modal = useCreatorModalBehavior({
    open,
    onClose,
    cleanup: creator.cleanup,
    outputKey: scheduleOutputKey(creator.parsedSchedule),
    hasSession: creator.session !== null
  })

  // ── i18n strings ───────────────────────────────────────────────
  const i18n = useMemo<CreatorModalI18n>(
    () => ({
      header: { title: t('aiCreator.title'), closeLabel: t('aiCreator.close') },
      discard: {
        title: t('aiCreator.discardTitle'),
        message: t('aiCreator.discardMessage'),
        confirm: t('aiCreator.discardConfirm'),
        cancel: t('aiCreator.discardCancel')
      },
      welcome: {
        title: t('aiCreator.welcomeTitle'),
        description: t('aiCreator.welcomeDescription'),
        inputPlaceholder: t('aiCreator.inputPlaceholder')
      },
      pausedPlaceholder: t('aiCreator.inputPlaceholderPaused'),
      suggestions: [
        t('aiCreator.suggestion.codeReview'),
        t('aiCreator.suggestion.weeklyReport'),
        t('aiCreator.suggestion.errorCheck')
      ]
    }),
    [t]
  )

  // ── Edit via ScheduleFormModal ─────────────────────────────────
  const [editingSchedule, setEditingSchedule] = useState<ParsedScheduleOutput | null>(null)
  const [createdScheduleFromForm, setCreatedScheduleFromForm] = useState<Schedule | null>(null)

  const handleEditSchedule = useCallback((parsed: ParsedScheduleOutput) => {
    setEditingSchedule(parsed)
  }, [])

  const handleScheduleCreatedFromForm = useCallback((created: Schedule) => {
    setCreatedScheduleFromForm(created)
    setEditingSchedule(null)
    modal.markConfirmed()
    toast(
      `${t('aiCreator.scheduleCreated')}: ${created.name}`,
      {
        action: {
          label: t('aiCreator.card.view'),
          onClick: () => openDetail({ type: 'schedule', scheduleId: created.id })
        }
      }
    )
  }, [t, openDetail, modal])

  const handleEditFormClose = useCallback(() => {
    setEditingSchedule(null)
  }, [])

  // ── Schedule creation handler (direct from card) ───────────────
  const handleConfirmSchedule = useCallback(
    async (parsed: ParsedScheduleOutput): Promise<Schedule> => {
      const input = toCreateScheduleInput(parsed, sessionConfig.projectId)
      const created = await createSchedule(input)
      modal.markConfirmed()
      toast(
        `${t('aiCreator.scheduleCreated')}: ${created.name}`,
        {
          action: {
            label: t('aiCreator.card.view'),
            onClick: () => openDetail({ type: 'schedule', scheduleId: created.id })
          }
        }
      )
      return created
    },
    [createSchedule, sessionConfig, t, openDetail, modal]
  )

  const handleNavigateToSchedule = useCallback(
    (scheduleId: string) => {
      openDetail({ type: 'schedule', scheduleId })
    },
    [openDetail]
  )

  // ── Footer node: ScheduleConfirmationCard ─────────────────────
  const footerNode = useMemo(() => {
    if (!creator.parsedSchedule) return undefined
    return (
      <ScheduleConfirmationCard
        schedule={creator.parsedSchedule}
        onConfirm={handleConfirmSchedule}
        onNavigate={handleNavigateToSchedule}
        onEdit={handleEditSchedule}
        createdSchedule={createdScheduleFromForm}
      />
    )
  }, [creator.parsedSchedule, handleConfirmSchedule, handleNavigateToSchedule, handleEditSchedule, createdScheduleFromForm])

  // ── Render ─────────────────────────────────────────────────────
  return (
    <CreatorModalControlled
      modal={modal}
      creator={creator}
      i18n={i18n}
      project={project}
      footerNode={footerNode}
      extraPortals={
        editingSchedule ? (
          <ScheduleFormModal
            defaultValues={toFormDefaults(editingSchedule, sessionConfig.projectId)}
            onCreated={handleScheduleCreatedFromForm}
            onClose={handleEditFormClose}
            zIndex={101}
          />
        ) : undefined
      }
    />
  )
}
