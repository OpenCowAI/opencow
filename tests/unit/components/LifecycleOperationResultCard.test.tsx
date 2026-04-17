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
  const markApplied = vi.fn()
  const listLifecycleOperations = vi.fn(async () => [])
  const logWrite = vi.fn(async () => {})
  return {
    api: {
      'command:confirm-session-lifecycle-operation': confirm,
      'command:reject-session-lifecycle-operation': reject,
      'command:mark-session-lifecycle-operation-applied': markApplied,
      'command:list-session-lifecycle-operations': listLifecycleOperations,
      'log:write': logWrite,
    },
    confirm,
    reject,
    markApplied,
    listLifecycleOperations,
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

vi.mock('@/components/IssueForm/IssueFormModal', () => ({
  IssueFormModal: (props: { onCreated: (issue: unknown) => void; onClose: () => void }) => (
    <div data-testid="issue-form-modal">
      <button
        type="button"
        onClick={() => props.onCreated({ id: 'issue-created-from-modal' })}
      >
        create issue
      </button>
      <button type="button" onClick={props.onClose}>close issue modal</button>
    </div>
  ),
}))

vi.mock('@/components/ScheduleView/ScheduleFormModal', () => ({
  ScheduleFormModal: (props: { onCreated: (schedule: unknown) => void; onClose: () => void }) => (
    <div data-testid="schedule-form-modal">
      <button
        type="button"
        onClick={() => props.onCreated({ id: 'schedule-created-from-modal' })}
      >
        create schedule
      </button>
      <button type="button" onClick={props.onClose}>close schedule modal</button>
    </div>
  ),
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
    apiMock.markApplied.mockReset()
    apiMock.listLifecycleOperations.mockReset()
    apiMock.listLifecycleOperations.mockResolvedValue([])
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

  it('shows target id and trigger preview for schedule update card', () => {
    const scheduleUpdate = makeEnvelope({
      entity: 'schedule',
      action: 'update',
      summary: {
        sessionId: 'session-1',
      },
      normalizedPayload: {
        sessionId: 'session-1',
        id: 'schedule-42',
        trigger: {
          time: {
            type: 'cron',
            cronExpression: '20 9 * * *',
            timezone: 'Asia/Shanghai',
          },
        },
      },
    })

    render(<LifecycleOperationResultCard data={scheduleUpdate} />)

    expect(screen.getByText('Target ID')).toBeInTheDocument()
    expect(screen.getByText('schedule-42')).toBeInTheDocument()
    expect(screen.getByText('cron: 20 9 * * *')).toBeInTheDocument()
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

  it('rehydrates latest operation state from lifecycle store and hides stale pending confirm', async () => {
    const stalePending = makeEnvelope({
      operationId: 'lop-rehydrate-1',
      entity: 'schedule',
      action: 'create',
      state: 'pending_confirmation',
      normalizedPayload: {
        sessionId: 'session-1',
        title: 'Daily sync',
      },
      summary: {
        sessionId: 'session-1',
        title: 'Daily sync',
      },
      updatedAt: '2026-04-08T00:00:00.000Z',
    })

    const latestApplied = makeEnvelope({
      operationId: 'lop-rehydrate-1',
      entity: 'schedule',
      action: 'create',
      state: 'applied',
      normalizedPayload: {
        sessionId: 'session-1',
        title: 'Daily sync',
      },
      summary: {
        sessionId: 'session-1',
        title: 'Daily sync',
      },
      updatedAt: '2026-04-08T00:01:00.000Z',
      appliedAt: '2026-04-08T00:01:00.000Z',
    })

    apiMock.listLifecycleOperations.mockResolvedValueOnce([latestApplied])

    render(<LifecycleOperationResultCard data={stalePending} currentSessionId="session-1" />)

    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
  })

  it('marks lifecycle draft as applied (not cancelled) after schedule manual create from edit fields', async () => {
    const operation = makeEnvelope({
      operationId: 'lop-manual-schedule-1',
      entity: 'schedule',
      action: 'create',
      state: 'pending_confirmation',
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
      summary: {
        sessionId: 'session-1',
        name: '每日 AI Agent 热门话题查询',
      },
    })

    apiMock.markApplied.mockResolvedValue({
      ok: true,
      code: 'marked_applied_externally',
      operation: makeEnvelope({
        ...operation,
        state: 'applied',
        updatedAt: new Date(Date.now() + 1_000).toISOString(),
        appliedAt: new Date().toISOString(),
        resultSnapshot: {
          source: 'manual_form_create',
        },
      }),
    })

    render(<LifecycleOperationResultCard data={operation} currentSessionId="session-1" />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /edit fields/i }))
    await user.click(screen.getByRole('button', { name: /create schedule/i }))

    await waitFor(() => {
      expect(apiMock.markApplied).toHaveBeenCalledTimes(1)
    })
    expect(apiMock.markApplied).toHaveBeenCalledWith(
      'session-1',
      'lop-manual-schedule-1',
      expect.objectContaining({
        source: 'manual_form_create',
        entityRef: {
          entity: 'schedule',
          id: 'schedule-created-from-modal',
        },
      }),
    )
    await waitFor(() => {
      expect(screen.getByText('Applied')).toBeInTheDocument()
    })
    expect(screen.queryByText('Cancelled')).toBeNull()
  })
})
