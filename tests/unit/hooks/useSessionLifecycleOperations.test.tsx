// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataBusEvent, SessionLifecycleOperationEnvelope } from '../../../src/shared/types'

const apiMock = vi.hoisted(() => {
  const listeners: Array<(event: DataBusEvent) => void> = []
  const list = vi.fn(async () => [] as SessionLifecycleOperationEnvelope[])
  const confirm = vi.fn(async () => ({ ok: false, code: 'invalid_state', operation: null }))
  const reject = vi.fn(async () => ({ ok: false, code: 'invalid_state', operation: null }))
  const onEvent = vi.fn((cb: (event: DataBusEvent) => void) => {
    listeners.push(cb)
    return () => {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  })

  return {
    listeners,
    api: {
      'command:list-session-lifecycle-operations': list,
      'command:confirm-session-lifecycle-operation': confirm,
      'command:reject-session-lifecycle-operation': reject,
      'on:opencow:event': onEvent,
    },
    list,
    confirm,
    reject,
  }
})

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => apiMock.api,
}))

import { useSessionLifecycleOperations } from '../../../src/renderer/hooks/useSessionLifecycleOperations'

function emit(event: DataBusEvent): void {
  for (const listener of [...apiMock.listeners]) {
    listener(event)
  }
}

describe('useSessionLifecycleOperations', () => {
  beforeEach(() => {
    apiMock.list.mockClear()
    apiMock.confirm.mockClear()
    apiMock.reject.mockClear()
    apiMock.listeners.splice(0, apiMock.listeners.length)
  })

  it('refreshes list when lifecycle operation update event is emitted for same session', async () => {
    apiMock.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    renderHook(() => useSessionLifecycleOperations('session-1'))

    await waitFor(() => {
      expect(apiMock.list).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      emit({
        type: 'session:lifecycle-operation:updated',
        payload: {
          sessionId: 'session-1',
          operationId: 'lop-1',
          entity: 'issue',
          action: 'create',
          state: 'applying',
        },
      })
    })

    await waitFor(() => {
      expect(apiMock.list).toHaveBeenCalledTimes(2)
    })
  })

  it('does not refresh for lifecycle operation events from other sessions', async () => {
    apiMock.list.mockResolvedValue([])

    renderHook(() => useSessionLifecycleOperations('session-1'))

    await waitFor(() => {
      expect(apiMock.list).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      emit({
        type: 'session:lifecycle-operation:updated',
        payload: {
          sessionId: 'session-2',
          operationId: 'lop-2',
          entity: 'issue',
          action: 'create',
          state: 'pending_confirmation',
        },
      })
    })

    expect(apiMock.list).toHaveBeenCalledTimes(1)
  })
})
