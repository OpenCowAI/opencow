// SPDX-License-Identifier: Apache-2.0

import type { ParsedIssueOutput } from '@shared/issueOutputParser'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import { mapScheduleLifecycleOperationToParsedDraft as mapSharedScheduleOperationToParsedDraft } from '@shared/scheduleLifecycleCanonical'
import type { SessionLifecycleOperationEnvelope } from '@shared/types'

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function coalesceString(primary: unknown, fallback: unknown): string {
  return asString(primary) ?? asString(fallback) ?? ''
}

export function mapIssueOperationToParsedDraft(
  operation: SessionLifecycleOperationEnvelope
): ParsedIssueOutput | null {
  if (operation.entity !== 'issue') return null
  const payload = operation.normalizedPayload

  const title = asString(payload.title)?.trim() ?? ''
  if (!title) return null

  const status = asString(payload.status)
  const priority = asString(payload.priority)

  return {
    title,
    description: coalesceString(payload.description, operation.summary.description),
    status: status === 'backlog' || status === 'todo' || status === 'in_progress' || status === 'done' || status === 'cancelled'
      ? status
      : 'backlog',
    priority: priority === 'urgent' || priority === 'high' || priority === 'medium' || priority === 'low'
      ? priority
      : 'medium',
    labels: asStringArray(payload.labels),
    projectId: asString(payload.projectId),
    parentIssueId: asString(payload.parentIssueId),
  }
}

export function mapScheduleOperationToParsedDraft(
  operation: SessionLifecycleOperationEnvelope
): ParsedScheduleOutput | null {
  return mapSharedScheduleOperationToParsedDraft(operation)
}
