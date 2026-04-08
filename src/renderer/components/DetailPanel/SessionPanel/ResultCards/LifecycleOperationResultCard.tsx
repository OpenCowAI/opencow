// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, Pencil, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CardShell } from './CardShell'
import type {
  Issue,
  Schedule,
  SessionLifecycleOperationConfirmResult,
  SessionLifecycleOperationEnvelope,
  SessionLifecycleOperationMarkAppliedResult,
  SessionLifecycleOperationRejectResult,
} from '@shared/types'
import { useIssueStore } from '@/stores/issueStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { IssueFormModal } from '@/components/IssueForm/IssueFormModal'
import { ScheduleFormModal } from '@/components/ScheduleView/ScheduleFormModal'
import { mapScheduleDraftToFormDefaults } from '@/lib/scheduleDraftMapper'
import {
  mapIssueOperationToParsedDraft,
  mapScheduleOperationToParsedDraft,
} from '@/lib/lifecycleOperationDraftMapper'
import {
  confirmSessionLifecycleOperation,
  markSessionLifecycleOperationApplied,
  rejectSessionLifecycleOperation,
} from '@/lib/sessionLifecycleOperationClient'
import type { ParsedIssueOutput } from '@shared/issueOutputParser'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'
import { getAppAPI } from '@/windowAPI'

export type LifecycleOperationCardData =
  | SessionLifecycleOperationEnvelope
  | SessionLifecycleOperationEnvelope[]

interface LifecycleOperationResultCardProps {
  data: LifecycleOperationCardData
  currentSessionId?: string
}

function resolveSessionId(data: SessionLifecycleOperationEnvelope): string | null {
  const payloadSessionId = data.normalizedPayload.sessionId
  if (typeof payloadSessionId === 'string' && payloadSessionId.trim().length > 0) {
    return payloadSessionId
  }
  const summarySessionId = data.summary.sessionId
  if (typeof summarySessionId === 'string' && summarySessionId.trim().length > 0) {
    return summarySessionId
  }
  return null
}

function statusIcon(state: SessionLifecycleOperationEnvelope['state']): React.ReactNode {
  if (state === 'applied') return <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden />
  if (state === 'failed') return <CircleAlert className="w-3.5 h-3.5 text-red-500" aria-hidden />
  if (state === 'cancelled') return <XCircle className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden />
  if (state === 'applying') return <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin text-[hsl(var(--primary))]" aria-hidden />
  return <CircleAlert className="w-3.5 h-3.5 text-[hsl(var(--primary))]" aria-hidden />
}

function statusText(state: SessionLifecycleOperationEnvelope['state'], t: (key: string, opts?: { defaultValue?: string }) => string): string {
  switch (state) {
    case 'pending_confirmation':
      return t('lifecycleOperation.status.pendingConfirmation', { defaultValue: 'Pending confirmation' })
    case 'applying':
      return t('lifecycleOperation.status.applying', { defaultValue: 'Applying' })
    case 'applied':
      return t('lifecycleOperation.status.applied', { defaultValue: 'Applied' })
    case 'failed':
      return t('lifecycleOperation.status.failed', { defaultValue: 'Failed' })
    case 'cancelled':
      return t('lifecycleOperation.status.cancelled', { defaultValue: 'Cancelled' })
    default:
      return state
  }
}

function buildTitle(data: SessionLifecycleOperationEnvelope): string {
  if (data.entity === 'issue') {
    const summaryTitle = typeof data.summary.title === 'string' ? data.summary.title : null
    const payloadTitle = typeof data.normalizedPayload.title === 'string' ? data.normalizedPayload.title : null
    if (summaryTitle) return summaryTitle
    if (payloadTitle) return payloadTitle
  }
  if (data.entity === 'schedule') {
    const summaryName = typeof data.summary.name === 'string' ? data.summary.name : null
    const payloadName = typeof data.normalizedPayload.name === 'string' ? data.normalizedPayload.name : null
    const summaryTitle = typeof data.summary.title === 'string' ? data.summary.title : null
    const payloadTitle = typeof data.normalizedPayload.title === 'string' ? data.normalizedPayload.title : null
    const summaryTask = typeof data.summary.task === 'string' ? data.summary.task : null
    const summarySchedule = typeof data.summary.schedule === 'string' ? data.summary.schedule : null
    const payloadTask =
      data.normalizedPayload.task && typeof data.normalizedPayload.task === 'object' && !Array.isArray(data.normalizedPayload.task)
        ? data.normalizedPayload.task as Record<string, unknown>
        : null
    const payloadTaskText = payloadTask
      ? (
          typeof payloadTask.description === 'string'
            ? payloadTask.description
            : (
                typeof payloadTask.instruction === 'string'
                  ? payloadTask.instruction
                  : (typeof payloadTask.prompt === 'string' ? payloadTask.prompt : null)
              )
        )
      : null
    if (summaryName) return summaryName
    if (payloadName) return payloadName
    if (summaryTitle) return summaryTitle
    if (payloadTitle) return payloadTitle
    if (summaryTask) return summaryTask
    if (payloadTaskText) return payloadTaskText
    if (summarySchedule) return summarySchedule
  }
  return `${data.entity} ${data.action}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const normalized = value.filter((item): item is number => typeof item === 'number')
  return normalized.length > 0 ? normalized : null
}

function formatScheduleTriggerPreview(timeRecord: Record<string, unknown>): string | null {
  const triggerType = asText(timeRecord.type)
  if (!triggerType) return null

  if (triggerType === 'cron') {
    const cron = asText(timeRecord.cronExpression) ?? asText(timeRecord.cron)
    return cron ? `cron: ${cron}` : 'cron'
  }

  if (triggerType === 'interval') {
    const interval = typeof timeRecord.intervalMinutes === 'number'
      ? timeRecord.intervalMinutes
      : null
    return interval ? `every ${interval} min` : 'interval'
  }

  if (triggerType === 'once') {
    const executeAt = typeof timeRecord.executeAt === 'number'
      ? new Date(timeRecord.executeAt).toISOString()
      : asText(timeRecord.executeAt)
    return executeAt ? `once at ${executeAt}` : 'once'
  }

  const timeOfDay = asText(timeRecord.timeOfDay)
  if (timeOfDay) return `${triggerType} at ${timeOfDay}`
  return triggerType
}

function readScheduleTimezone(operation: SessionLifecycleOperationEnvelope): string | null {
  const summaryTz = asText(operation.summary.timezone)
  if (summaryTz) return summaryTz

  const payload = operation.normalizedPayload
  const scheduleRecord = asRecord(payload.schedule)
  const triggerRecord = asRecord(payload.trigger)
  const triggerTimeRecord = asRecord(triggerRecord?.time)

  return (
    asText(scheduleRecord?.timezone) ??
    asText(triggerTimeRecord?.timezone) ??
    null
  )
}

function readScheduleTaskPreview(
  operation: SessionLifecycleOperationEnvelope,
  parsedSchedule: ParsedScheduleOutput | null
): string | null {
  const summaryTask = asText(operation.summary.task)
  if (summaryTask) return summaryTask
  if (parsedSchedule?.prompt) return parsedSchedule.prompt

  const payload = operation.normalizedPayload
  const taskRecord = asRecord(payload.task)
  const actionRecord = asRecord(payload.action)
  const actionSessionRecord = asRecord(actionRecord?.session)

  return (
    asText(taskRecord?.instruction) ??
    asText(taskRecord?.prompt) ??
    asText(taskRecord?.promptTemplate) ??
    asText(actionSessionRecord?.promptTemplate) ??
    asText(actionSessionRecord?.prompt) ??
    null
  )
}

interface PreviewRow {
  label: string
  value: string
}

function buildPreviewRows(
  operation: SessionLifecycleOperationEnvelope,
  parsedIssue: ParsedIssueOutput | null,
  parsedSchedule: ParsedScheduleOutput | null,
  t: (key: string, opts?: { defaultValue?: string }) => string
): PreviewRow[] {
  if (operation.entity === 'issue') {
    const rows: PreviewRow[] = []
    if (parsedIssue?.description) {
      rows.push({
        label: t('lifecycleOperation.preview.description', { defaultValue: 'Description' }),
        value: parsedIssue.description,
      })
    }
    rows.push({
      label: t('lifecycleOperation.preview.status', { defaultValue: 'Status' }),
      value: parsedIssue?.status ?? 'backlog',
    })
    rows.push({
      label: t('lifecycleOperation.preview.priority', { defaultValue: 'Priority' }),
      value: parsedIssue?.priority ?? 'medium',
    })
    if (parsedIssue?.labels?.length) {
      rows.push({
        label: t('lifecycleOperation.preview.labels', { defaultValue: 'Labels' }),
        value: parsedIssue.labels.join(', '),
      })
    }
    return rows
  }

  const scheduleText =
    asText(operation.summary.schedule) ??
    asText(operation.summary.runAt) ??
    null
  const taskText = readScheduleTaskPreview(operation, parsedSchedule)
  const timezoneText = readScheduleTimezone(operation)
  const payload = operation.normalizedPayload
  const scheduleRecord = asRecord(payload.schedule)
  const triggerRecord = asRecord(payload.trigger)
  const triggerTimeRecord = asRecord(triggerRecord?.time)
  const scheduleTimeRecord = asRecord(scheduleRecord?.time)
  const triggerPreview = formatScheduleTriggerPreview(triggerTimeRecord ?? scheduleTimeRecord ?? {})
  const targetId =
    asText(payload.id) ??
    asText(scheduleRecord?.id) ??
    asText(operation.summary.id) ??
    asText(operation.summary.scheduleId)
  const rows: PreviewRow[] = []

  if (operation.action === 'update' && targetId) {
    rows.push({
      label: t('lifecycleOperation.preview.targetId', { defaultValue: 'Target ID' }),
      value: targetId,
    })
  }

  if (scheduleText) {
    rows.push({
      label: t('lifecycleOperation.preview.schedule', { defaultValue: 'Schedule' }),
      value: scheduleText,
    })
  } else if (triggerPreview) {
    rows.push({
      label: t('lifecycleOperation.preview.schedule', { defaultValue: 'Schedule' }),
      value: triggerPreview,
    })
  }
  if (taskText) {
    rows.push({
      label: t('lifecycleOperation.preview.task', { defaultValue: 'Task' }),
      value: taskText,
    })
  }
  if (timezoneText) {
    rows.push({
      label: t('lifecycleOperation.preview.timezone', { defaultValue: 'Timezone' }),
      value: timezoneText,
    })
  }
  if (parsedSchedule?.description) {
    rows.push({
      label: t('lifecycleOperation.preview.description', { defaultValue: 'Description' }),
      value: parsedSchedule.description,
    })
  }

  // Last-resort fallback so pending cards never render as empty shell.
  if (rows.length === 0) {
    const taskRecord = asRecord(payload.task)
    const days = asNumberArray(payload.daysOfWeek)
    const roughSummary = [
      asText(payload.frequency),
      asText(payload.timeOfDay),
      days ? `days=${days.join(',')}` : null,
      asText(taskRecord?.instruction),
    ].filter((item): item is string => !!item)

    if (roughSummary.length > 0) {
      rows.push({
        label: t('lifecycleOperation.preview.schedule', { defaultValue: 'Schedule' }),
        value: roughSummary.join(' · '),
      })
    }
  }

  return rows
}

function isLifecycleOperationEnvelope(value: unknown): value is SessionLifecycleOperationEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.operationId === 'string' && typeof record.entity === 'string' && typeof record.action === 'string'
}

export function parseLifecycleOperationData(raw: string): LifecycleOperationCardData {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) {
    const items = parsed.filter((item): item is SessionLifecycleOperationEnvelope => isLifecycleOperationEnvelope(item))
    if (items.length === 0) {
      throw new Error('Invalid lifecycle operation result array')
    }
    return items
  }
  if (!isLifecycleOperationEnvelope(parsed)) {
    throw new Error('Invalid lifecycle operation result object')
  }
  return parsed
}

function LifecycleOperationSingleCard(
  { data, currentSessionId }: { data: SessionLifecycleOperationEnvelope; currentSessionId?: string }
): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const loadIssues = useIssueStore((s) => s.loadIssues)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const [operation, setOperation] = useState<SessionLifecycleOperationEnvelope>(data)
  const [pendingAction, setPendingAction] = useState<'confirm' | 'reject' | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [editingIssue, setEditingIssue] = useState<ParsedIssueOutput | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<ParsedScheduleOutput | null>(null)

  useEffect(() => {
    setOperation(data)
  }, [data.operationId, data.updatedAt])

  // Rehydrate from operation store on mount so page refresh / session switch-back
  // does not fall back to stale tool_result snapshot state.
  useEffect(() => {
    const candidateSessionIds = [
      currentSessionId ?? null,
      resolveSessionId(data),
    ].filter((value, index, arr): value is string => typeof value === 'string' && value.length > 0 && arr.indexOf(value) === index)
    if (candidateSessionIds.length === 0) return
    let cancelled = false
    void Promise.all(
      candidateSessionIds.map((sessionId) => getAppAPI()['command:list-session-lifecycle-operations'](sessionId))
    ).then((operationGroups) => {
      if (cancelled) return
      const latest = operationGroups
        .flat()
        .filter((item) => item.operationId === data.operationId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (!latest) return
      setOperation((prev) => (latest.updatedAt > prev.updatedAt ? latest : prev))
    })
      .catch(() => {
        // best-effort hydration only
      })
    return () => {
      cancelled = true
    }
  }, [currentSessionId, data.operationId, data.updatedAt])

  const isPending = operation.state === 'pending_confirmation'
  const isApplying = operation.state === 'applying'
  const isTerminal = operation.state === 'applied' || operation.state === 'failed' || operation.state === 'cancelled'
  const parsedIssueDraft = useMemo(
    () => mapIssueOperationToParsedDraft(operation),
    [operation]
  )
  const parsedScheduleDraft = useMemo(
    () => mapScheduleOperationToParsedDraft(operation),
    [operation]
  )

  const refreshEntityList = useCallback(() => {
    if (operation.entity === 'issue') {
      void loadIssues()
      return
    }
    if (operation.entity === 'schedule') {
      void loadSchedules()
    }
  }, [operation.entity, loadIssues, loadSchedules])

  const operationSessionId = useMemo(() => resolveSessionId(operation), [operation])
  const isSessionMismatch = useMemo(() => {
    if (!currentSessionId || !operationSessionId) return false
    return currentSessionId !== operationSessionId
  }, [currentSessionId, operationSessionId])
  const effectiveSessionId = currentSessionId ?? operationSessionId
  const hasValidOperationSession = !isSessionMismatch && !!effectiveSessionId
  const canEditFields = useMemo(() => {
    if (!isPending) return false
    if (operation.action !== 'create') return false
    if (!hasValidOperationSession) return false
    if (operation.entity === 'issue') return !!parsedIssueDraft
    if (operation.entity === 'schedule') return !!parsedScheduleDraft
    return false
  }, [hasValidOperationSession, isPending, operation.action, operation.entity, parsedIssueDraft, parsedScheduleDraft])
  const previewRows = useMemo(
    () => buildPreviewRows(operation, parsedIssueDraft, parsedScheduleDraft, t),
    [operation, parsedIssueDraft, parsedScheduleDraft, t]
  )

  const handleConfirm = useCallback(async () => {
    if (!effectiveSessionId) {
      setLocalError(
        t('lifecycleOperation.error.missingSession', {
          defaultValue: 'Operation session context is missing. Please regenerate the draft.',
        })
      )
      return
    }
    if (isSessionMismatch) {
      setLocalError(
        t('lifecycleOperation.error.crossSession', {
          defaultValue: 'This draft belongs to another session. Please regenerate it in the current session.',
        })
      )
      return
    }
    setPendingAction('confirm')
    setLocalError(null)
    try {
      const result: SessionLifecycleOperationConfirmResult = await confirmSessionLifecycleOperation({
        sessionId: effectiveSessionId,
        operationId: operation.operationId,
        timeoutMessage: t('lifecycleOperation.error.confirmTimeout', {
          defaultValue: 'Confirmation timed out. Please retry.',
        }),
      })
      if (result.operation) setOperation(result.operation)
      if (result.ok) {
        refreshEntityList()
        return
      }
      setLocalError(result.operation?.errorMessage ?? `Confirm failed: ${result.code}`)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingAction(null)
    }
  }, [effectiveSessionId, isSessionMismatch, operation.operationId, refreshEntityList, t])

  const handleReject = useCallback(async () => {
    if (!effectiveSessionId) {
      setLocalError(
        t('lifecycleOperation.error.missingSession', {
          defaultValue: 'Operation session context is missing. Please regenerate the draft.',
        })
      )
      return
    }
    if (isSessionMismatch) {
      setLocalError(
        t('lifecycleOperation.error.crossSession', {
          defaultValue: 'This draft belongs to another session. Please regenerate it in the current session.',
        })
      )
      return
    }
    setPendingAction('reject')
    setLocalError(null)
    try {
      const result: SessionLifecycleOperationRejectResult = await rejectSessionLifecycleOperation({
        sessionId: effectiveSessionId,
        operationId: operation.operationId,
        timeoutMessage: t('lifecycleOperation.error.rejectTimeout', {
          defaultValue: 'Cancellation timed out. Please retry.',
        }),
      })
      if (result.operation) setOperation(result.operation)
      if (result.ok) {
        refreshEntityList()
        return
      }
      setLocalError(result.operation?.errorMessage ?? `Reject failed: ${result.code}`)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingAction(null)
    }
  }, [effectiveSessionId, isSessionMismatch, operation.operationId, refreshEntityList, t])

  const openEditModal = useCallback(() => {
    if (!canEditFields) return
    if (operation.entity === 'issue' && parsedIssueDraft) {
      setEditingIssue(parsedIssueDraft)
      return
    }
    if (operation.entity === 'schedule' && parsedScheduleDraft) {
      setEditingSchedule(parsedScheduleDraft)
    }
  }, [canEditFields, operation.entity, parsedIssueDraft, parsedScheduleDraft])

  const markPendingAsAppliedAfterManualCreate = useCallback(async (entityId: string) => {
    if (!effectiveSessionId) return
    if (!isPending) return
    try {
      const result: SessionLifecycleOperationMarkAppliedResult = await markSessionLifecycleOperationApplied({
        sessionId: effectiveSessionId,
        operationId: operation.operationId,
        input: {
          source: 'manual_form_create',
          entityRef: {
            entity: operation.entity,
            id: entityId,
          },
        },
        timeoutMessage: t('lifecycleOperation.error.confirmTimeout', {
          defaultValue: 'Confirmation timed out. Please retry.',
        }),
      })
      if (result.operation) setOperation(result.operation)
    } catch {
      // Manual create already succeeded. Keep local UX stable even if mark-applied races.
    }
  }, [effectiveSessionId, isPending, operation.operationId, t])

  const handleIssueCreatedFromEdit = useCallback((created: Issue) => {
    setEditingIssue(null)
    setLocalError(null)
    void loadIssues()
    void markPendingAsAppliedAfterManualCreate(created.id)
  }, [loadIssues, markPendingAsAppliedAfterManualCreate])

  const handleScheduleCreatedFromEdit = useCallback((created: Schedule) => {
    setEditingSchedule(null)
    setLocalError(null)
    void loadSchedules()
    void markPendingAsAppliedAfterManualCreate(created.id)
  }, [loadSchedules, markPendingAsAppliedAfterManualCreate])

  return (
    <CardShell maxWidth="md" className="ml-0 mt-2">
      <div className="px-3 py-2 border-b border-[hsl(var(--border)/0.3)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {statusIcon(operation.state)}
          <div className="min-w-0">
            <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
              {buildTitle(operation)}
            </div>
            <div className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {operation.entity} / {operation.action}
            </div>
          </div>
        </div>
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{statusText(operation.state, t)}</span>
      </div>

      {operation.warnings.length > 0 && (
        <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-[hsl(var(--border)/0.3)]">
          {operation.warnings.join(' · ')}
        </div>
      )}

      {isSessionMismatch && (
        <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-[hsl(var(--border)/0.3)]">
          {t('lifecycleOperation.error.crossSessionReadonly', {
            defaultValue: 'This draft belongs to another session and cannot be confirmed here.',
          })}
        </div>
      )}

      {(operation.errorMessage || localError) && (
        <div className="px-3 py-2 text-xs text-red-500 border-b border-[hsl(var(--border)/0.3)]">
          {operation.errorMessage ?? localError}
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="px-3 py-2 text-xs border-b border-[hsl(var(--border)/0.3)] space-y-1.5">
          {previewRows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="flex items-start gap-2">
              <span className="text-[hsl(var(--muted-foreground))] min-w-[72px]">{row.label}</span>
              <span className="text-[hsl(var(--foreground))] break-words whitespace-pre-wrap">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {!isTerminal && (
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <div>
            {canEditFields && (
              <button
                type="button"
                onClick={openEditModal}
                disabled={pendingAction !== null}
                className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Pencil className="w-3 h-3" aria-hidden />
                {t('lifecycleOperation.editFields', { defaultValue: 'Edit fields' })}
              </button>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            {isPending && (
              <>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={pendingAction !== null || !hasValidOperationSession}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)]"
                >
                  {t('common:cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={pendingAction !== null || !hasValidOperationSession}
                  className="inline-flex items-center gap-1 px-3 py-1 text-[11px] rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                >
                  {pendingAction === 'confirm'
                    ? t('lifecycleOperation.confirming', { defaultValue: 'Confirming...' })
                    : t('common:confirm', { defaultValue: 'Confirm' })}
                </button>
              </>
            )}
            {isApplying && (
              <span className="text-[11px] text-[hsl(var(--muted-foreground))] inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden />
                {t('lifecycleOperation.applying', { defaultValue: 'Applying...' })}
              </span>
            )}
          </div>
        </div>
      )}

      {editingIssue && (
        <IssueFormModal
          defaultProjectId={editingIssue.projectId ?? null}
          parentIssueId={editingIssue.parentIssueId ?? null}
          defaultValues={{
            title: editingIssue.title,
            description: editingIssue.description,
            status: editingIssue.status,
            priority: editingIssue.priority,
            labels: editingIssue.labels,
          }}
          skipSelectOnCreate
          onCreated={handleIssueCreatedFromEdit}
          onClose={() => setEditingIssue(null)}
          zIndex={101}
        />
      )}

      {editingSchedule && (
        <ScheduleFormModal
          defaultValues={mapScheduleDraftToFormDefaults(
            editingSchedule,
            editingSchedule.projectId ??
              (
                operation.normalizedPayload.projectId === null ||
                typeof operation.normalizedPayload.projectId === 'string'
                  ? operation.normalizedPayload.projectId
                  : null
              )
          )}
          onCreated={handleScheduleCreatedFromEdit}
          onClose={() => setEditingSchedule(null)}
          zIndex={101}
        />
      )}
    </CardShell>
  )
}

export function LifecycleOperationResultCard({ data, currentSessionId }: LifecycleOperationResultCardProps): React.JSX.Element {
  if (Array.isArray(data)) {
    return (
      <div className="space-y-2">
        {data.map((item) => (
          <LifecycleOperationSingleCard key={item.operationId} data={item} currentSessionId={currentSessionId} />
        ))}
      </div>
    )
  }
  return <LifecycleOperationSingleCard data={data} currentSessionId={currentSessionId} />
}
