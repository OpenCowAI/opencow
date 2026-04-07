// SPDX-License-Identifier: Apache-2.0

import type {
  ActionType,
  ContextInjectionType,
  SessionLifecycleOperationEnvelope,
  ScheduleAction,
  ScheduleFrequency,
  SchedulePriority,
  ScheduleTrigger,
  WorkMode,
} from './types'
import type { ParsedScheduleOutput, ScheduleFrequencyType } from './scheduleOutputParser'

export interface ScheduleLifecycleCanonicalPayload extends Record<string, unknown> {
  sessionId?: string
  id?: string
  name?: string
  description?: string
  priority?: SchedulePriority
  projectId?: string | null
  trigger?: ScheduleTrigger
  action?: ScheduleAction
}

interface NormalizeScheduleLifecyclePayloadContext {
  sessionId: string
  projectId: string | null
}

const VALID_SCHEDULE_PRIORITIES = new Set<SchedulePriority>(['critical', 'high', 'normal', 'low'])
const VALID_ACTION_TYPES = new Set<ActionType>([
  'start_session',
  'resume_session',
  'create_issue',
  'webhook',
  'notification',
])
const VALID_WORK_MODES = new Set<WorkMode>(['all_days', 'weekdays', 'big_small_week'])
const VALID_FREQUENCY_TYPES = new Set<ScheduleFrequency['type']>([
  'once',
  'interval',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'cron',
])
const VALID_CONTEXT_INJECTIONS = new Set<ContextInjectionType>([
  'git_diff_24h',
  'git_log_week',
  'last_execution_result',
  'open_issues',
  'today_stats',
  'recent_errors',
  'changed_files',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return asNonEmptyString(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value
    .map((item) => asNumber(item))
    .filter((item): item is number => item !== undefined)
  return out.length > 0 ? out : undefined
}

function parseSchedulePriority(value: unknown): SchedulePriority | undefined {
  if (typeof value !== 'string') return undefined
  if (VALID_SCHEDULE_PRIORITIES.has(value as SchedulePriority)) return value as SchedulePriority
  return undefined
}

function parseActionType(value: unknown): ActionType | undefined {
  if (typeof value !== 'string') return undefined
  if (VALID_ACTION_TYPES.has(value as ActionType)) return value as ActionType
  return undefined
}

function parseWorkMode(value: unknown): WorkMode {
  if (typeof value === 'string' && VALID_WORK_MODES.has(value as WorkMode)) {
    return value as WorkMode
  }
  return 'all_days'
}

function parseFrequencyType(value: unknown): ScheduleFrequency['type'] | undefined {
  if (typeof value !== 'string') return undefined
  if (VALID_FREQUENCY_TYPES.has(value as ScheduleFrequency['type'])) {
    return value as ScheduleFrequency['type']
  }
  return undefined
}

function parseTriggerFrequency(record: Record<string, unknown>): ScheduleFrequency | undefined {
  const rawType = record.type ?? record.frequency
  const type = parseFrequencyType(rawType)
  if (!type) return undefined

  const cronExpression =
    asNonEmptyString(record.cronExpression) ??
    asNonEmptyString(record.cron) ??
    asNonEmptyString(record.expression)

  const out: ScheduleFrequency = {
    type,
    workMode: parseWorkMode(record.workMode),
    timezone: asNonEmptyString(record.timezone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeOfDay: asNonEmptyString(record.timeOfDay),
    daysOfWeek: asNumberArray(record.daysOfWeek),
    dayOfMonth: asNumber(record.dayOfMonth),
    intervalMinutes: asNumber(record.intervalMinutes),
    cronExpression,
    executeAt: asNumber(record.executeAt),
  }

  return out
}

function parseEventTrigger(record: Record<string, unknown>): ScheduleTrigger['event'] | undefined {
  const matcherType = asNonEmptyString(record.matcherType ?? record.eventMatcherType)
  if (!matcherType) return undefined
  const filter = asRecord(record.filter ?? record.eventFilter) ?? {}
  return {
    matcherType,
    filter,
  }
}

function parseScheduleTriggerCandidate(value: unknown): ScheduleTrigger | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  const timeNode = asRecord(record.time)
  const eventNode = asRecord(record.event)

  const time = timeNode ? parseTriggerFrequency(timeNode) : parseTriggerFrequency(record)
  const event = eventNode ? parseEventTrigger(eventNode) : parseEventTrigger(record)

  if (!time && !event) return undefined
  return {
    time,
    event,
    throttleMs: asNumber(record.throttleMs),
  }
}

function parseContextInjections(value: unknown): ContextInjectionType[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is ContextInjectionType =>
    typeof item === 'string' && VALID_CONTEXT_INJECTIONS.has(item as ContextInjectionType)
  )
  return out.length > 0 ? out : undefined
}

function resolvePromptText(
  actionRecord: Record<string, unknown>,
  payloadRecord: Record<string, unknown>
): string | undefined {
  const actionSessionRecord = asRecord(actionRecord.session)
  const taskRecord = asRecord(payloadRecord.task)
  return (
    asNonEmptyString(actionSessionRecord?.promptTemplate) ??
    asNonEmptyString(actionSessionRecord?.prompt) ??
    asNonEmptyString(actionSessionRecord?.instruction) ??
    asNonEmptyString(actionRecord.promptTemplate) ??
    asNonEmptyString(actionRecord.prompt) ??
    asNonEmptyString(actionRecord.instruction) ??
    asNonEmptyString(payloadRecord.promptTemplate) ??
    asNonEmptyString(payloadRecord.prompt) ??
    asNonEmptyString(payloadRecord.instruction) ??
    asNonEmptyString(taskRecord?.promptTemplate) ??
    asNonEmptyString(taskRecord?.prompt) ??
    asNonEmptyString(taskRecord?.instruction) ??
    asNonEmptyString(taskRecord?.description)
  )
}

function parseScheduleActionCandidate(
  value: unknown,
  payloadRecord: Record<string, unknown>
): ScheduleAction | undefined {
  const actionRecord = asRecord(value) ?? {}
  const actionType = parseActionType(actionRecord.type ?? actionRecord.actionType ?? payloadRecord.type ?? payloadRecord.actionType)
  const promptText = resolvePromptText(actionRecord, payloadRecord)

  if (!actionType && !promptText) return undefined

  const out: ScheduleAction = {
    type: actionType ?? 'start_session',
  }

  if (promptText) {
    out.session = {
      promptTemplate: promptText,
      model: asNonEmptyString(actionRecord.model ?? payloadRecord.model),
      maxTurns: asNumber(actionRecord.maxTurns ?? payloadRecord.maxTurns),
    }
  }

  const projectId = asNullableString(actionRecord.projectId ?? payloadRecord.projectId)
  if (projectId !== undefined) out.projectId = projectId ?? undefined

  const issueId = asNonEmptyString(actionRecord.issueId ?? payloadRecord.issueId)
  if (issueId) out.issueId = issueId

  const resumeMode = asNonEmptyString(actionRecord.resumeMode)
  if (resumeMode === 'resume_last' || resumeMode === 'resume_specific') {
    out.resumeMode = resumeMode
  }
  const resumeSessionId = asNonEmptyString(actionRecord.resumeSessionId)
  if (resumeSessionId) out.resumeSessionId = resumeSessionId

  const contextInjections = parseContextInjections(actionRecord.contextInjections)
  if (contextInjections) out.contextInjections = contextInjections

  return out
}

function resolveScheduleName(payloadRecord: Record<string, unknown>): string | undefined {
  const taskRecord = asRecord(payloadRecord.task)
  return (
    asNonEmptyString(payloadRecord.name) ??
    asNonEmptyString(payloadRecord.title) ??
    asNonEmptyString(taskRecord?.description) ??
    asNonEmptyString(taskRecord?.instruction) ??
    asNonEmptyString(taskRecord?.prompt)
  )
}

export function normalizeScheduleLifecycleProposalPayload(
  payload: Record<string, unknown>,
  context: NormalizeScheduleLifecyclePayloadContext
): ScheduleLifecycleCanonicalPayload {
  const scheduleRecord = asRecord(payload.schedule)

  const out: ScheduleLifecycleCanonicalPayload = {
    sessionId: asNonEmptyString(payload.sessionId) ?? context.sessionId,
  }

  const id = asNonEmptyString(payload.id)
  if (id) out.id = id

  const name = resolveScheduleName(payload)
  if (name) out.name = name

  const description = asNonEmptyString(payload.description)
  if (description) out.description = description

  const priority = parseSchedulePriority(payload.priority)
  if (priority) out.priority = priority

  const explicitProjectId = asNullableString(payload.projectId)
  if (explicitProjectId !== undefined) {
    out.projectId = explicitProjectId
  }

  const trigger =
    parseScheduleTriggerCandidate(payload.trigger) ??
    parseScheduleTriggerCandidate(scheduleRecord) ??
    parseScheduleTriggerCandidate(payload)
  if (trigger) out.trigger = trigger

  const action =
    parseScheduleActionCandidate(payload.action, payload) ??
    parseScheduleActionCandidate(payload.task, payload) ??
    parseScheduleActionCandidate(payload, payload)

  if (action) {
    if (action.projectId === undefined) {
      const fallbackProjectId = explicitProjectId === undefined ? context.projectId : explicitProjectId
      action.projectId = fallbackProjectId ?? undefined
    }
    out.action = action
  }

  return out
}

function resolveDraftFrequency(value: unknown): ScheduleFrequencyType {
  if (
    value === 'once' ||
    value === 'interval' ||
    value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'cron'
  ) {
    return value
  }
  return 'daily'
}

function resolveDraftPriority(value: unknown): ParsedScheduleOutput['priority'] {
  if (value === 'critical' || value === 'high' || value === 'normal' || value === 'low') {
    return value
  }
  return 'normal'
}

/**
 * Convert schedule lifecycle operation payload to ParsedScheduleOutput so
 * renderer preview cards and form defaults consume the same canonical model.
 */
export function mapScheduleLifecycleOperationToParsedDraft(
  operation: SessionLifecycleOperationEnvelope
): ParsedScheduleOutput | null {
  if (operation.entity !== 'schedule') return null

  const payload = operation.normalizedPayload
  const summary = operation.summary
  const operationSessionId =
    asNonEmptyString(payload.sessionId) ??
    asNonEmptyString(summary.sessionId) ??
    'unknown-session'
  const contextProjectId =
    asNullableString(payload.projectId) ??
    asNullableString(summary.projectId) ??
    null

  const canonical = normalizeScheduleLifecycleProposalPayload(payload, {
    sessionId: operationSessionId,
    projectId: contextProjectId,
  })
  const triggerTime = canonical.trigger?.time

  const name =
    canonical.name ??
    asNonEmptyString(summary.name) ??
    asNonEmptyString(summary.title) ??
    asNonEmptyString(summary.task) ??
    asNonEmptyString(summary.schedule)
  if (!name) return null

  const prompt =
    canonical.action?.session?.promptTemplate ??
    asNonEmptyString(summary.prompt) ??
    asNonEmptyString(summary.task) ??
    asNonEmptyString(payload.prompt) ??
    ''

  const executeAt = triggerTime?.executeAt
  const parsedExecuteAt =
    typeof executeAt === 'number' && Number.isFinite(executeAt)
      ? new Date(executeAt).toISOString()
      : undefined
  const parsedProjectId =
    canonical.projectId !== undefined
      ? canonical.projectId
      : canonical.action?.projectId

  return {
    name,
    description:
      canonical.description ??
      asNonEmptyString(summary.description) ??
      '',
    frequency: resolveDraftFrequency(
      triggerTime?.type ??
      asNonEmptyString(summary.frequency) ??
      payload.frequency
    ),
    timeOfDay: triggerTime?.timeOfDay,
    intervalMinutes: triggerTime?.intervalMinutes,
    daysOfWeek: triggerTime?.daysOfWeek,
    cronExpression: triggerTime?.cronExpression,
    executeAt: parsedExecuteAt,
    prompt,
    priority: resolveDraftPriority(canonical.priority ?? summary.priority),
    projectId: parsedProjectId,
  }
}
