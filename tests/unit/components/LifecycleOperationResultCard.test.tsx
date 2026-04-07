// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import type { SessionLifecycleOperationEnvelope } from '../../../src/shared/types'
import { LifecycleOperationResultCard } from '../../../src/renderer/components/DetailPanel/SessionPanel/ResultCards/LifecycleOperationResultCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

const apiMock = vi.hoisted(() => {
  const confirm = vi.fn()
  const reject = vi.fn()
  const logWrite = vi.fn(async () => {})
  return {
    api: {
      'command:confirm-session-lifecycle-operation': confirm,
      'command:reject-session-lifecycle-operation': reject,
      'log:write': logWrite,
    },
    confirm,
    reject,
    logWrite,
  }
})

const issueStoreMock = vi.hoisted(() => ({
  loadIssues: vi.fn(async () => {}),
}))

const scheduleStoreMock = vi.hoisted(() => ({
  loadSchedules: vi.fn(async () => {}),
}))

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => apiMock.api,
}))

vi.mock('@/stores/issueStore', () => ({
  useIssueStore: (selector: (s: typeof issueStoreMock) => unknown) => selector(issueStoreMock),
}))

vi.mock('@/stores/scheduleStore', () => ({
  useScheduleStore: (selector: (s: typeof scheduleStoreMock) => unknown) => selector(scheduleStoreMock),
}))

function makeEnvelope(overrides: Partial<SessionLifecycleOperationEnvelope> = {}): SessionLifecycleOperationEnvelope {
  return {
    operationId: 'lop-1',
    operationIndex: 0,
    entity: 'issue',
    action: 'create',
    confirmationMode: 'required',
    state: 'pending_confirmation',
    normalizedPayload: {
      sessionId: 'session-1',
      title: 'Create lifecycle issue',
    },
    summary: {
      sessionId: 'session-1',
      title: 'Create lifecycle issue',
    },
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appliedAt: null,
    resultSnapshot: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  }
}

describe('LifecycleOperationResultCard', () => {
  beforeEach(() => {
    apiMock.confirm.mockReset()
    apiMock.reject.mockReset()
    issueStoreMock.loadIssues.mockClear()
    scheduleStoreMock.loadSchedules.mockClear()
  })

  it('updates status to Applied immediately after confirm result', async () => {
    const base = makeEnvelope()
    const updated = makeEnvelope({
      state: 'applied',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      appliedAt: new Date().toISOString(),
    })

    apiMock.confirm.mockResolvedValue({
      ok: true,
      code: 'confirmed_applied',
      operation: updated,
    })

    render(<LifecycleOperationResultCard data={base} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeInTheDocument()
    })
    expect(issueStoreMock.loadIssues).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('syncs with newer upstream data that keeps same operationId', async () => {
    const base = makeEnvelope({ state: 'pending_confirmation' })
    const { rerender } = render(<LifecycleOperationResultCard data={base} />)
    expect(screen.getByText('Pending confirmation')).toBeInTheDocument()

    const upstream = makeEnvelope({
      state: 'cancelled',
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    })

    await act(async () => {
      rerender(<LifecycleOperationResultCard data={upstream} />)
    })

    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})
