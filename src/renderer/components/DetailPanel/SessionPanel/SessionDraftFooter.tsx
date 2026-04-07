// SPDX-License-Identifier: Apache-2.0

/**
 * SessionDraftFooter — In-session Issue/Schedule draft confirmation entry.
 *
 * Reuses the same confirmation cards and apply actions as AI Creator modals,
 * but renders directly inside regular session message footers.
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/stores/appStore'
import { selectIssue } from '@/actions/issueActions'
import { useDraftApplyActions } from '@/hooks/useDraftApplyActions'
import { useSessionDraftCreatedState } from '@/hooks/useSessionDraftCreatedState'
import { useSessionLifecycleOperations } from '@/hooks/useSessionLifecycleOperations'
import { IssueConfirmationCard } from '@/components/IssueAICreator/IssueConfirmationCard'
import { ScheduleConfirmationCard } from '@/components/ScheduleAICreator/ScheduleConfirmationCard'
import { IssueFormModal } from '@/components/IssueForm/IssueFormModal'
import { ScheduleFormModal } from '@/components/ScheduleView/ScheduleFormModal'
import { mapScheduleDraftToFormDefaults } from '@/lib/scheduleDraftMapper'
import { LifecycleOperationActionTimeoutError } from '@/lib/sessionLifecycleOperationClient'
import { toast } from '@/lib/toast'
import { useTranslation } from 'react-i18next'
import type { SessionDraftType } from '@shared/sessionDraftOutputParser'
import type { ParsedIssueOutput } from '@shared/issueOutputParser'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import type { Issue, Schedule } from '@shared/types'

export interface SessionDraftFooterProps {
  sessionId: string
  activeDraftKey: string | null
  activeDraftType: SessionDraftType
  latestIssueDraft: ParsedIssueOutput | null
  latestScheduleDraft: ParsedScheduleOutput | null
  projectId?: string | null
  issueCreationMode?: 'standalone' | 'subissue'
  defaultParentIssueId?: string | null
  lifecycleOperationId?: string | null
  lifecycleSource?: 'fenced-output' | 'lifecycle-operation'
}

export function SessionDraftFooter({
  sessionId,
  activeDraftKey,
  activeDraftType,
  latestIssueDraft,
  latestScheduleDraft,
  projectId,
  issueCreationMode = 'standalone',
  defaultParentIssueId,
  lifecycleOperationId,
  lifecycleSource = 'fenced-output',
}: SessionDraftFooterProps): React.JSX.Element | null {
  const { t: ti } = useTranslation('issues')
  const { t: ts } = useTranslation('schedule')
  const { t: tSession } = useTranslation('sessions')
  const openDetail = useAppStore((s) => s.openDetail)
  const { applyIssueDraft, applyScheduleDraft } = useDraftApplyActions()
  const lifecycle = useSessionLifecycleOperations(
    lifecycleSource === 'lifecycle-operation' ? sessionId : null
  )
  const {
    createdIssueId,
    createdScheduleId,
    markIssueCreated,
    markScheduleCreated,
  } = useSessionDraftCreatedState({
    sessionId,
    draftType: activeDraftType,
    draftKey: activeDraftKey,
  })

  const [editingIssue, setEditingIssue] = useState<ParsedIssueOutput | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<ParsedScheduleOutput | null>(null)
  const [createdIssueRefFromForm, setCreatedIssueRefFromForm] = useState<{ id: string } | null>(null)
  const [createdScheduleRefFromForm, setCreatedScheduleRefFromForm] = useState<{ id: string } | null>(null)

  useEffect(() => {
    setEditingIssue(null)
    setEditingSchedule(null)
    setCreatedIssueRefFromForm(null)
    setCreatedScheduleRefFromForm(null)
  }, [activeDraftKey])

  const effectiveParentIssueId = useMemo<string | null>(() => {
    if (issueCreationMode === 'subissue') {
      return defaultParentIssueId ?? null
    }
    return null
  }, [issueCreationMode, defaultParentIssueId])

  const handleConfirmIssue = useCallback(
    async (parsed: ParsedIssueOutput): Promise<Issue> => {
      if (lifecycleSource === 'lifecycle-operation' && lifecycleOperationId) {
        let result
        try {
          result = await lifecycle.confirm(lifecycleOperationId)
        } catch (err) {
          if (err instanceof LifecycleOperationActionTimeoutError) {
            throw new Error(tSession('lifecycleOperation.error.confirmTimeout', {
              defaultValue: 'Confirmation timed out. Please retry.',
            }))
          }
          throw err
        }
        const issue = result.operation?.resultSnapshot?.issue as Issue | undefined
        if (!issue?.id) {
          throw new Error(result.operation?.errorMessage ?? ti('aiCreator.card.createFailed'))
        }
        markIssueCreated(issue.id)
        return issue
      }

      const created = await applyIssueDraft({
        parsed,
        projectId,
        parentIssueId: effectiveParentIssueId,
      })
      markIssueCreated(created.id)
      return created
    },
    [
      applyIssueDraft,
      projectId,
      effectiveParentIssueId,
      markIssueCreated,
      lifecycleSource,
      lifecycleOperationId,
      lifecycle,
      ti,
      tSession,
    ]
  )

  const handleConfirmSchedule = useCallback(
    async (parsed: ParsedScheduleOutput): Promise<Schedule> => {
      if (lifecycleSource === 'lifecycle-operation' && lifecycleOperationId) {
        let result
        try {
          result = await lifecycle.confirm(lifecycleOperationId)
        } catch (err) {
          if (err instanceof LifecycleOperationActionTimeoutError) {
            throw new Error(tSession('lifecycleOperation.error.confirmTimeout', {
              defaultValue: 'Confirmation timed out. Please retry.',
            }))
          }
          throw err
        }
        const schedule = result.operation?.resultSnapshot?.schedule as Schedule | undefined
        if (!schedule?.id) {
          throw new Error(result.operation?.errorMessage ?? ts('aiCreator.card.createFailed'))
        }
        markScheduleCreated(schedule.id)
        return schedule
      }

      const created = await applyScheduleDraft({
        parsed,
        projectId,
      })
      markScheduleCreated(created.id)
      return created
    },
    [
      applyScheduleDraft,
      projectId,
      markScheduleCreated,
      lifecycleSource,
      lifecycleOperationId,
      lifecycle,
      ts,
      tSession,
    ]
  )

  const handleNavigateToIssue = useCallback((issueId: string) => {
    selectIssue(issueId)
  }, [])

  const handleNavigateToSchedule = useCallback(
    (scheduleId: string) => {
      openDetail({ type: 'schedule', scheduleId })
    },
    [openDetail]
  )

  const handleIssueCreatedFromForm = useCallback(
    (created: Issue) => {
      markIssueCreated(created.id)
      setCreatedIssueRefFromForm({ id: created.id })
      setEditingIssue(null)
      toast(`${ti('aiCreator.issueCreated')}: ${created.title}`, {
        action: {
          label: ti('aiCreator.card.view'),
          onClick: () => selectIssue(created.id),
        },
      })
    },
    [ti, markIssueCreated]
  )

  const handleScheduleCreatedFromForm = useCallback(
    (created: Schedule) => {
      markScheduleCreated(created.id)
      setCreatedScheduleRefFromForm({ id: created.id })
      setEditingSchedule(null)
      toast(`${ts('aiCreator.scheduleCreated')}: ${created.name}`, {
        action: {
          label: ts('aiCreator.card.view'),
          onClick: () => openDetail({ type: 'schedule', scheduleId: created.id }),
        },
      })
    },
    [ts, openDetail, markScheduleCreated]
  )

  const effectiveCreatedIssueRef = useMemo(
    () => createdIssueRefFromForm ?? (createdIssueId ? { id: createdIssueId } : null),
    [createdIssueRefFromForm, createdIssueId]
  )

  const effectiveCreatedScheduleRef = useMemo(
    () => createdScheduleRefFromForm ?? (createdScheduleId ? { id: createdScheduleId } : null),
    [createdScheduleRefFromForm, createdScheduleId]
  )

  const cardNode = useMemo(() => {
    if (activeDraftType === 'issue' && latestIssueDraft) {
      return (
        <IssueConfirmationCard
          key={activeDraftKey ?? 'issue-draft'}
          issue={latestIssueDraft}
          onConfirm={handleConfirmIssue}
          onNavigate={handleNavigateToIssue}
          onEdit={setEditingIssue}
          createdIssueRef={effectiveCreatedIssueRef}
          className="ml-0"
        />
      )
    }

    if (activeDraftType === 'schedule' && latestScheduleDraft) {
      return (
        <ScheduleConfirmationCard
          key={activeDraftKey ?? 'schedule-draft'}
          schedule={latestScheduleDraft}
          onConfirm={handleConfirmSchedule}
          onNavigate={handleNavigateToSchedule}
          onEdit={setEditingSchedule}
          createdScheduleRef={effectiveCreatedScheduleRef}
          className="ml-0"
        />
      )
    }

    return null
  }, [
    activeDraftType,
    latestIssueDraft,
    latestScheduleDraft,
    handleConfirmIssue,
    handleConfirmSchedule,
    handleNavigateToIssue,
    handleNavigateToSchedule,
    effectiveCreatedIssueRef,
    effectiveCreatedScheduleRef,
  ])

  if (!cardNode) return null

  return (
    <>
      {cardNode}
      {editingIssue && (
        <IssueFormModal
          defaultProjectId={projectId}
          parentIssueId={editingIssue.parentIssueId ?? effectiveParentIssueId}
          defaultValues={{
            title: editingIssue.title,
            description: editingIssue.description,
            status: editingIssue.status,
            priority: editingIssue.priority,
            labels: editingIssue.labels,
          }}
          onCreated={handleIssueCreatedFromForm}
          onClose={() => setEditingIssue(null)}
          zIndex={101}
        />
      )}
      {editingSchedule && (
        <ScheduleFormModal
          defaultValues={mapScheduleDraftToFormDefaults(editingSchedule, projectId)}
          onCreated={handleScheduleCreatedFromForm}
          onClose={() => setEditingSchedule(null)}
          zIndex={101}
        />
      )}
    </>
  )
}
