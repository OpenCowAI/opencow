// SPDX-License-Identifier: Apache-2.0

import type { ParsedIssueOutput } from '@shared/issueOutputParser'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import type { SessionLifecycleOperationEnvelope } from '@shared/types'

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toOptionalString(value: string | null): string | undefined {
  return value ?? undefined
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
  if (operation.entity !== 'schedule') return null
  const payload = operation.normalizedPayload
  const summary = operation.summary

  const name = asString(payload.name)?.trim() ?? asString(summary.name)?.trim() ?? ''
  if (!name) return null

  const frequency = asString(payload.frequency) ?? asString(summary.frequency) ?? 'daily'
  const priority = asString(payload.priority) ?? asString(summary.priority) ?? 'normal'

  return {
    name,
    description: coalesceString(payload.description, summary.description),
    frequency:
      frequency === 'daily' ||
      frequency === 'weekly' ||
      frequency === 'monthly' ||
      frequency === 'interval' ||
      frequency === 'once' ||
      frequency === 'cron'
        ? frequency
        : 'daily',
    timeOfDay: toOptionalString(asString(payload.timeOfDay) ?? asString(summary.timeOfDay)),
    intervalMinutes: typeof payload.intervalMinutes === 'number' ? payload.intervalMinutes : undefined,
    daysOfWeek: Array.isArray(payload.daysOfWeek)
      ? payload.daysOfWeek.filter((item): item is number => typeof item === 'number')
      : undefined,
    cronExpression: toOptionalString(asString(payload.cronExpression)),
    executeAt: toOptionalString(asString(payload.executeAt)),
    prompt: coalesceString(payload.prompt, summary.prompt),
    priority: priority === 'critical' || priority === 'high' || priority === 'normal' || priority === 'low'
      ? priority
      : 'normal',
    projectId: asString(payload.projectId),
  }
}
