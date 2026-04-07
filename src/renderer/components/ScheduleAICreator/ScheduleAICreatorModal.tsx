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
 *   - Schedule creation via shared `useDraftApplyActions`
 *   - Mapping helpers reused from `scheduleDraftMapper`
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
import { useDraftApplyActions } from '@/hooks/useDraftApplyActions'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { mapScheduleDraftToFormDefaults } from '@/lib/scheduleDraftMapper'
import { toast } from '@/lib/toast'
import type { Schedule } from '@shared/types'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

/** Derive a stable identity key from parsed schedule output for discard-guard comparison. */
function scheduleOutputKey(p: ParsedScheduleOutput | null): string | null {
  if (!p) return null
  return `${p.name}\0${p.frequency}\0${p.prompt.slice(0, 100)}`
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
  const { applyScheduleDraft } = useDraftApplyActions()
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
  const [createdScheduleRefFromForm, setCreatedScheduleRefFromForm] = useState<{ id: string } | null>(null)

  const handleEditSchedule = useCallback((parsed: ParsedScheduleOutput) => {
    setEditingSchedule(parsed)
  }, [])

  const handleScheduleCreatedFromForm = useCallback((created: Schedule) => {
    setCreatedScheduleRefFromForm({ id: created.id })
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
      const created = await applyScheduleDraft({
        parsed,
        projectId: sessionConfig.projectId,
      })
      modal.markConfirmed()
      return created
    },
    [applyScheduleDraft, sessionConfig.projectId, modal]
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
        createdScheduleRef={createdScheduleRefFromForm}
      />
    )
  }, [creator.parsedSchedule, handleConfirmSchedule, handleNavigateToSchedule, handleEditSchedule, createdScheduleRefFromForm])

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
            defaultValues={mapScheduleDraftToFormDefaults(editingSchedule, sessionConfig.projectId)}
            onCreated={handleScheduleCreatedFromForm}
            onClose={handleEditFormClose}
            zIndex={101}
          />
        ) : undefined
      }
    />
  )
}
