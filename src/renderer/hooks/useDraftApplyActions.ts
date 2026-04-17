// SPDX-License-Identifier: Apache-2.0

/**
 * useDraftApplyActions — Shared apply executors for issue/schedule drafts.
 *
 * Phase A centralizes draft confirmation side effects (create + toast + navigate)
 * so creator modals and future session-footer flows reuse one implementation.
 *
 * @module
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useIssueStore } from '@/stores/issueStore'
import { useAppStore } from '@/stores/appStore'
import { selectIssue } from '@/actions/issueActions'
import { toast } from '@/lib/toast'
import { mapScheduleDraftToCreateInput } from '@/lib/scheduleDraftMapper'
import type { ParsedIssueOutput } from '@shared/issueOutputParser'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import type { CreateIssueInput, Issue, Schedule } from '@shared/types'

export interface ApplyIssueDraftParams {
  parsed: ParsedIssueOutput
  projectId?: string | null
  parentIssueId?: string | null
  providerId?: string | null
  onApplied?: (created: Issue) => void
}

export interface ApplyScheduleDraftParams {
  parsed: ParsedScheduleOutput
  projectId?: string | null
  onApplied?: (created: Schedule) => void
}

export interface DraftApplyActions {
  applyIssueDraft: (params: ApplyIssueDraftParams) => Promise<Issue>
  applyScheduleDraft: (params: ApplyScheduleDraftParams) => Promise<Schedule>
}

export function useDraftApplyActions(): DraftApplyActions {
  const { t: ti } = useTranslation('issues')
  const { t: ts } = useTranslation('schedule')
  const createIssue = useIssueStore((s) => s.createIssue)
  const createSchedule = useScheduleStore((s) => s.createSchedule)
  const openDetail = useAppStore((s) => s.openDetail)

  const applyIssueDraft = useCallback(
    async ({ parsed, projectId, parentIssueId, providerId, onApplied }: ApplyIssueDraftParams): Promise<Issue> => {
      const input: CreateIssueInput = {
        title: parsed.title,
        description: parsed.description,
        status: parsed.status,
        priority: parsed.priority,
        labels: parsed.labels,
        projectId,
        parentIssueId: parsed.parentIssueId ?? parentIssueId,
        providerId: providerId ?? null,
      }

      const created = await createIssue(input)
      onApplied?.(created)

      toast(`${ti('aiCreator.issueCreated')}: ${created.title}`, {
        action: {
          label: ti('aiCreator.card.view'),
          onClick: () => selectIssue(created.id),
        },
      })

      return created
    },
    [createIssue, ti]
  )

  const applyScheduleDraft = useCallback(
    async ({ parsed, projectId, onApplied }: ApplyScheduleDraftParams): Promise<Schedule> => {
      const created = await createSchedule(mapScheduleDraftToCreateInput(parsed, projectId))
      onApplied?.(created)

      toast(`${ts('aiCreator.scheduleCreated')}: ${created.name}`, {
        action: {
          label: ts('aiCreator.card.view'),
          onClick: () => openDetail({ type: 'schedule', scheduleId: created.id }),
        },
      })

      return created
    },
    [createSchedule, openDetail, ts]
  )

  return { applyIssueDraft, applyScheduleDraft }
}

