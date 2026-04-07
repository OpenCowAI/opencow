// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import type { SessionLifecycleOperationEnvelope } from '../../../src/shared/types'
import {
  LifecycleOperationResultCard,
  parseLifecycleOperationData,
} from '../../../src/renderer/components/DetailPanel/SessionPanel/ResultCards/LifecycleOperationResultCard'

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

  afterEach(() => {
    vi.useRealTimers()
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

  it('renders multiple cards when propose result contains envelopes array', () => {
    const first = makeEnvelope({
      operationId: 'lop-1',
      summary: { sessionId: 'session-1', title: 'Issue A' },
      normalizedPayload: { sessionId: 'session-1', title: 'Issue A' },
    })
    const second = makeEnvelope({
      operationId: 'lop-2',
      entity: 'schedule',
      action: 'create',
      summary: { sessionId: 'session-1', name: 'Schedule B' },
      normalizedPayload: { sessionId: 'session-1', name: 'Schedule B' },
    })
    const parsed = parseLifecycleOperationData(JSON.stringify([first, second]))

    render(<LifecycleOperationResultCard data={parsed} />)

    expect(screen.getByText('Issue A')).toBeInTheDocument()
    expect(screen.getByText('Schedule B')).toBeInTheDocument()
  })

  it('uses schedule title fallback from summary.title when summary.name is missing', () => {
    const schedule = makeEnvelope({
      entity: 'schedule',
      action: 'create',
      summary: {
        sessionId: 'session-1',
        title: '每日 AI Agent 热门话题查询',
      },
      normalizedPayload: {
        sessionId: 'session-1',
        schedule: {
          type: 'cron',
          expression: '40 9 * * *',
          timezone: 'Asia/Shanghai',
        },
        task: {
          instruction: '查询 AI Agent 热门话题',
        },
      },
    })

    render(<LifecycleOperationResultCard data={schedule} />)

    expect(screen.getByText('每日 AI Agent 热门话题查询')).toBeInTheDocument()
  })

  it('uses schedule title from payload.name when summary fields are sparse', () => {
    const schedule = makeEnvelope({
      entity: 'schedule',
      action: 'create',
      summary: {
        sessionId: 'session-1',
        schedule: '每天 09:40（Asia/Shanghai）',
      },
      normalizedPayload: {
        sessionId: 'session-1',
        name: '每日 AI Agent 热门话题查询',
        trigger: {
          time: {
            type: 'cron',
            cronExpression: '40 9 * * *',
            timezone: 'Asia/Shanghai',
          },
        },
        action: {
          type: 'start_session',
          session: {
            promptTemplate: '查询 AI Agent 热门话题',
          },
        },
      },
    })

    render(<LifecycleOperationResultCard data={schedule} />)

    expect(screen.getByText('每日 AI Agent 热门话题查询')).toBeInTheDocument()
  })

  it('shows timeout error and exits confirming state when confirm request hangs', async () => {
    vi.useFakeTimers()
    apiMock.confirm.mockImplementation(() => new Promise(() => {}))

    const base = makeEnvelope()
    render(<LifecycleOperationResultCard data={base} />)

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(screen.getByRole('button', { name: /confirming/i })).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(30_001)
      await Promise.resolve()
    })

    expect(screen.getByText('Confirmation timed out. Please retry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled()
  })

  it('disables confirm/reject when operation belongs to another session', async () => {
    const schedule = makeEnvelope({
      entity: 'schedule',
      action: 'create',
      summary: {
        sessionId: 'session-1',
        title: 'Cross-session draft',
      },
      normalizedPayload: {
        sessionId: 'session-1',
        title: 'Cross-session draft',
      },
    })

    render(<LifecycleOperationResultCard data={schedule} currentSessionId="session-2" />)

    expect(screen.getByText('This draft belongs to another session and cannot be confirmed here.')).toBeInTheDocument()
    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    expect(confirmButton).toBeDisabled()
    expect(cancelButton).toBeDisabled()

    const user = userEvent.setup()
    await user.click(confirmButton)
    expect(apiMock.confirm).not.toHaveBeenCalled()
  })
})
