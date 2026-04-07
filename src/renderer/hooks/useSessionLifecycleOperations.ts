// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAppAPI } from '@/windowAPI'
import type {
  DataBusEvent,
  SessionLifecycleOperationConfirmResult,
  SessionLifecycleOperationEnvelope,
  SessionLifecycleOperationRejectResult,
} from '@shared/types'

interface UseSessionLifecycleOperationsResult {
  operations: SessionLifecycleOperationEnvelope[]
  latestPendingIssueOperation: SessionLifecycleOperationEnvelope | null
  latestPendingScheduleOperation: SessionLifecycleOperationEnvelope | null
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
  confirm: (operationId: string) => Promise<SessionLifecycleOperationConfirmResult>
  reject: (operationId: string) => Promise<SessionLifecycleOperationRejectResult>
}

function isOperationMessageEventForSession(event: DataBusEvent, sessionId: string): boolean {
  if (event.type !== 'command:session:message') return false
  return event.payload.sessionId === sessionId
}

function isLifecycleOperationEventForSession(event: DataBusEvent, sessionId: string): boolean {
  if (event.type !== 'session:lifecycle-operation:updated') return false
  return event.payload.sessionId === sessionId
}

function pickLatestPendingByEntity(
  operations: SessionLifecycleOperationEnvelope[],
  entity: SessionLifecycleOperationEnvelope['entity']
): SessionLifecycleOperationEnvelope | null {
  for (let i = operations.length - 1; i >= 0; i--) {
    const candidate = operations[i]
    if (candidate.entity !== entity) continue
    if (candidate.state !== 'pending_confirmation') continue
    return candidate
  }
  return null
}

export function useSessionLifecycleOperations(sessionId: string | null): UseSessionLifecycleOperationsResult {
  const [operations, setOperations] = useState<SessionLifecycleOperationEnvelope[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const fetchOperations = useCallback(async (showInitialLoading: boolean) => {
    if (!sessionId) {
      setOperations([])
      return
    }
    if (showInitialLoading) setLoading(true)
    setRefreshing(true)
    try {
      const list = await getAppAPI()['command:list-session-lifecycle-operations'](sessionId)
      setOperations(list)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchOperations(true)
  }, [fetchOperations])

  useEffect(() => {
    if (!sessionId) return
    const unsub = getAppAPI()['on:opencow:event']((event) => {
      if (!isOperationMessageEventForSession(event, sessionId) && !isLifecycleOperationEventForSession(event, sessionId)) return
      void fetchOperations(false)
    })
    return unsub
  }, [sessionId, fetchOperations])

  const refresh = useCallback(async () => {
    await fetchOperations(false)
  }, [fetchOperations])

  const confirm = useCallback(async (operationId: string): Promise<SessionLifecycleOperationConfirmResult> => {
    if (!sessionId) {
      return { ok: false, code: 'invalid_state', operation: null }
    }
    const result = await getAppAPI()['command:confirm-session-lifecycle-operation'](sessionId, operationId)
    await fetchOperations(false)
    return result
  }, [sessionId, fetchOperations])

  const reject = useCallback(async (operationId: string): Promise<SessionLifecycleOperationRejectResult> => {
    if (!sessionId) {
      return { ok: false, code: 'invalid_state', operation: null }
    }
    const result = await getAppAPI()['command:reject-session-lifecycle-operation'](sessionId, operationId)
    await fetchOperations(false)
    return result
  }, [sessionId, fetchOperations])

  const latestPendingIssueOperation = useMemo(
    () => pickLatestPendingByEntity(operations, 'issue'),
    [operations]
  )
  const latestPendingScheduleOperation = useMemo(
    () => pickLatestPendingByEntity(operations, 'schedule'),
    [operations]
  )

  return {
    operations,
    latestPendingIssueOperation,
    latestPendingScheduleOperation,
    loading,
    refreshing,
    refresh,
    confirm,
    reject,
  }
}
