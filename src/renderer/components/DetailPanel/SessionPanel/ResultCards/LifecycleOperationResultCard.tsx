// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getAppAPI } from '@/windowAPI'
import { CardShell } from './CardShell'
import type {
  SessionLifecycleOperationConfirmResult,
  SessionLifecycleOperationEnvelope,
  SessionLifecycleOperationRejectResult,
} from '@shared/types'
import { useIssueStore } from '@/stores/issueStore'
import { useScheduleStore } from '@/stores/scheduleStore'

interface LifecycleOperationResultCardProps {
  data: SessionLifecycleOperationEnvelope
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

function statusText(state: SessionLifecycleOperationEnvelope['state']): string {
  switch (state) {
    case 'pending_confirmation':
      return 'Pending confirmation'
    case 'applying':
      return 'Applying'
    case 'applied':
      return 'Applied'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
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
    if (summaryName) return summaryName
    if (payloadName) return payloadName
  }
  return `${data.entity} ${data.action}`
}

export function parseLifecycleOperationData(raw: string): SessionLifecycleOperationEnvelope {
  return JSON.parse(raw) as SessionLifecycleOperationEnvelope
}

export function LifecycleOperationResultCard({ data }: LifecycleOperationResultCardProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const loadIssues = useIssueStore((s) => s.loadIssues)
  const loadSchedules = useScheduleStore((s) => s.loadSchedules)
  const [operation, setOperation] = useState<SessionLifecycleOperationEnvelope>(data)
  const [pendingAction, setPendingAction] = useState<'confirm' | 'reject' | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setOperation(data)
  }, [data.operationId, data.updatedAt])

  const isPending = operation.state === 'pending_confirmation'
  const isApplying = operation.state === 'applying'
  const isTerminal = operation.state === 'applied' || operation.state === 'failed' || operation.state === 'cancelled'

  const refreshEntityList = useCallback(() => {
    if (operation.entity === 'issue') {
      void loadIssues()
      return
    }
    if (operation.entity === 'schedule') {
      void loadSchedules()
    }
  }, [operation.entity, loadIssues, loadSchedules])

  const sessionId = useMemo(() => resolveSessionId(operation), [operation])

  const handleConfirm = useCallback(async () => {
    if (!sessionId) return
    setPendingAction('confirm')
    setLocalError(null)
    try {
      const result: SessionLifecycleOperationConfirmResult = await getAppAPI()['command:confirm-session-lifecycle-operation'](
        sessionId,
        operation.operationId
      )
      if (result.operation) setOperation(result.operation)
      if (result.ok) {
        refreshEntityList()
        return
      }
      setLocalError(result.operation?.errorMessage ?? `Confirm failed: ${result.code}`)
    } finally {
      setPendingAction(null)
    }
  }, [operation.operationId, refreshEntityList, sessionId])

  const handleReject = useCallback(async () => {
    if (!sessionId) return
    setPendingAction('reject')
    setLocalError(null)
    try {
      const result: SessionLifecycleOperationRejectResult = await getAppAPI()['command:reject-session-lifecycle-operation'](
        sessionId,
        operation.operationId
      )
      if (result.operation) setOperation(result.operation)
      if (result.ok) {
        refreshEntityList()
        return
      }
      setLocalError(result.operation?.errorMessage ?? `Reject failed: ${result.code}`)
    } finally {
      setPendingAction(null)
    }
  }, [operation.operationId, refreshEntityList, sessionId])

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
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{statusText(operation.state)}</span>
      </div>

      {operation.warnings.length > 0 && (
        <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-[hsl(var(--border)/0.3)]">
          {operation.warnings.join(' · ')}
        </div>
      )}

      {(operation.errorMessage || localError) && (
        <div className="px-3 py-2 text-xs text-red-500 border-b border-[hsl(var(--border)/0.3)]">
          {operation.errorMessage ?? localError}
        </div>
      )}

      {!isTerminal && (
        <div className="px-3 py-2 flex items-center justify-end gap-2">
          {isPending && (
            <>
              <button
                type="button"
                onClick={handleReject}
                disabled={pendingAction !== null}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)]"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pendingAction !== null}
                className="inline-flex items-center gap-1 px-3 py-1 text-[11px] rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              >
                {pendingAction === 'confirm'
                  ? 'Confirming...'
                  : t('common.confirm', { defaultValue: 'Confirm' })}
              </button>
            </>
          )}
          {isApplying && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))] inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 motion-safe:animate-spin" aria-hidden />
              Applying...
            </span>
          )}
        </div>
      )}
    </CardShell>
  )
}
