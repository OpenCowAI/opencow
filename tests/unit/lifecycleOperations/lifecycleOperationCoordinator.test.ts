// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { LifecycleOperationCoordinator } from '../../../electron/services/lifecycleOperations/lifecycleOperationCoordinator'
import type {
  ScheduleExecution,
  SessionLifecycleOperation,
} from '../../../src/shared/types'

function makeOperation(overrides: Partial<SessionLifecycleOperation> = {}): SessionLifecycleOperation {
  return {
    id: overrides.id ?? 'lop-1',
    sessionId: overrides.sessionId ?? 'session-1',
    toolUseId: overrides.toolUseId ?? 'tool-1',
    operationIndex: overrides.operationIndex ?? 0,
    entity: overrides.entity ?? 'issue',
    action: overrides.action ?? 'create',
    normalizedPayload: overrides.normalizedPayload ?? {},
    summary: overrides.summary ?? {},
    warnings: overrides.warnings ?? [],
    confirmationMode: overrides.confirmationMode ?? 'required',
    state: overrides.state ?? 'pending_confirmation',
    idempotencyKey: overrides.idempotencyKey ?? null,
    resultSnapshot: overrides.resultSnapshot ?? null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    appliedAt: overrides.appliedAt ?? null,
  }
}

describe('LifecycleOperationCoordinator', () => {
  it('creates operations with stable operationIndex and pending state', async () => {
    const inserted: SessionLifecycleOperation[] = []
    const store = {
      withTransaction: async <T>(fn: (store: any) => Promise<T>) => fn(store),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      findBySessionToolUseOperationIndex: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async (op: SessionLifecycleOperation) => {
        inserted.push(op)
      }),
    }

    const coordinator = new LifecycleOperationCoordinator({ store: store as any })
    const envelopes = await coordinator.proposeOperations({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      proposals: [
        { entity: 'issue', action: 'create', normalizedPayload: { title: 'A' } },
        { entity: 'schedule', action: 'update', normalizedPayload: { id: 's1' } },
      ],
    })

    expect(envelopes).toHaveLength(2)
    expect(envelopes[0].operationIndex).toBe(0)
    expect(envelopes[1].operationIndex).toBe(1)
    expect(envelopes[0].state).toBe('pending_confirmation')
    expect(envelopes[1].state).toBe('pending_confirmation')

    expect(inserted).toHaveLength(2)
    expect(inserted[0].operationIndex).toBe(0)
    expect(inserted[1].operationIndex).toBe(1)
  })

  it('returns existing record by idempotency key', async () => {
    const existing = makeOperation({ id: 'lop-existing', idempotencyKey: 'idem-1' })
    const store = {
      withTransaction: async <T>(fn: (store: any) => Promise<T>) => fn(store),
      findByIdempotencyKey: vi.fn().mockResolvedValue(existing),
      findBySessionToolUseOperationIndex: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    }

    const coordinator = new LifecycleOperationCoordinator({ store: store as any })
    const envelopes = await coordinator.proposeOperations({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      proposals: [
        {
          entity: 'issue',
          action: 'create',
          normalizedPayload: { title: 'A' },
          idempotencyKey: 'idem-1',
        },
      ],
    })

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].operationId).toBe('lop-existing')
    expect(store.upsert).not.toHaveBeenCalled()
  })

  it('returns existing record by (sessionId, toolUseId, operationIndex)', async () => {
    const existing = makeOperation({ id: 'lop-tuple', operationIndex: 0 })
    const store = {
      withTransaction: async <T>(fn: (store: any) => Promise<T>) => fn(store),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      findBySessionToolUseOperationIndex: vi.fn().mockResolvedValue(existing),
      upsert: vi.fn(),
    }

    const coordinator = new LifecycleOperationCoordinator({ store: store as any })
    const envelopes = await coordinator.proposeOperations({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      proposals: [{ entity: 'issue', action: 'create', normalizedPayload: { title: 'A' } }],
    })

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].operationId).toBe('lop-tuple')
    expect(store.upsert).not.toHaveBeenCalled()
  })

  it('dispatches session:lifecycle-operation:updated on propose', async () => {
    const dispatch = vi.fn()
    const store = {
      withTransaction: async <T>(fn: (store: any) => Promise<T>) => fn(store),
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      findBySessionToolUseOperationIndex: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async (_op: SessionLifecycleOperation) => {}),
    }

    const coordinator = new LifecycleOperationCoordinator({ store: store as any, dispatch })
    await coordinator.proposeOperations({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      proposals: [
        { entity: 'issue', action: 'create', normalizedPayload: { title: 'A' } },
      ],
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:lifecycle-operation:updated',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          entity: 'issue',
          action: 'create',
          state: 'pending_confirmation',
        }),
      })
    )
  })

  it('dispatches lifecycle updates on confirm applying + terminal state', async () => {
    const operation = makeOperation({
      id: 'lop-confirm-1',
      sessionId: 'session-1',
      entity: 'issue',
      action: 'create',
      state: 'pending_confirmation',
      normalizedPayload: {
        sessionId: 'session-1',
        title: 'Create by lifecycle',
        status: 'todo',
        priority: 'medium',
        labels: [],
      },
      summary: { sessionId: 'session-1' },
    })

    const stateById = new Map<string, SessionLifecycleOperation>([
      [operation.id, operation],
    ])

    const store = {
      withTransaction: async <T>(fn: (txStore: any, db: any) => Promise<T>) =>
        fn(store, { __mockDb: true }),
      getById: vi.fn(async (id: string) => stateById.get(id) ?? null),
      transitionStateCompareAndSet: vi.fn(async (params: {
        id: string
        fromState: SessionLifecycleOperation['state']
        toState: SessionLifecycleOperation['state']
        updatedAt: number
        appliedAt?: number | null
        resultSnapshot?: Record<string, unknown> | null
        errorCode?: string | null
        errorMessage?: string | null
      }) => {
        const current = stateById.get(params.id)
        if (!current || current.state !== params.fromState) return false
        stateById.set(params.id, {
          ...current,
          state: params.toState,
          updatedAt: params.updatedAt,
          appliedAt: params.appliedAt ?? null,
          resultSnapshot: params.resultSnapshot ?? null,
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
        })
        return true
      }),
    }

    const dispatch = vi.fn()
    const coordinator = new LifecycleOperationCoordinator({ store: store as any, dispatch })
    vi.spyOn(coordinator as any, 'createIssueWithDb').mockResolvedValue({
      id: 'issue-created-1',
      title: 'Create by lifecycle',
      description: '',
      status: 'todo',
      priority: 'medium',
      labels: [],
      projectId: null,
      parentIssueId: null,
      providerId: null,
      sessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const result = await coordinator.confirmOperation({
      sessionId: 'session-1',
      operationId: operation.id,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('confirmed_applied')
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'session:lifecycle-operation:updated',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          operationId: operation.id,
          state: 'applying',
        }),
      })
    )
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'session:lifecycle-operation:updated',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          operationId: operation.id,
          state: 'applied',
        }),
      })
    )
  })

  it('dispatches lifecycle update on reject terminal transition', async () => {
    const operation = makeOperation({
      id: 'lop-reject-1',
      sessionId: 'session-1',
      entity: 'issue',
      action: 'create',
      state: 'pending_confirmation',
      normalizedPayload: { sessionId: 'session-1', title: 'Reject me' },
      summary: { sessionId: 'session-1' },
    })
    const stateById = new Map<string, SessionLifecycleOperation>([
      [operation.id, operation],
    ])

    const store = {
      withTransaction: async <T>(fn: (txStore: any) => Promise<T>) => fn(store),
      getById: vi.fn(async (id: string) => stateById.get(id) ?? null),
      transitionStateCompareAndSet: vi.fn(async (params: {
        id: string
        fromState: SessionLifecycleOperation['state']
        toState: SessionLifecycleOperation['state']
        updatedAt: number
      }) => {
        const current = stateById.get(params.id)
        if (!current || current.state !== params.fromState) return false
        stateById.set(params.id, {
          ...current,
          state: params.toState,
          updatedAt: params.updatedAt,
          appliedAt: null,
        })
        return true
      }),
    }

    const dispatch = vi.fn()
    const coordinator = new LifecycleOperationCoordinator({ store: store as any, dispatch })

    const result = await coordinator.rejectOperation({
      sessionId: 'session-1',
      operationId: operation.id,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('rejected')
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session:lifecycle-operation:updated',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          operationId: operation.id,
          state: 'cancelled',
        }),
      })
    )
  })

  it('applies schedule create operation via scheduleService in confirm path', async () => {
    const createdAt = Date.now()
    const operation = makeOperation({
      id: 'lop-schedule-create-1',
      sessionId: 'session-1',
      entity: 'schedule',
      action: 'create',
      state: 'pending_confirmation',
      normalizedPayload: {
        sessionId: 'session-1',
        name: 'Weekly report',
        description: 'from lifecycle',
        frequency: 'weekly',
        timeOfDay: '10:30',
        daysOfWeek: [1, 3, 5],
        prompt: 'Generate weekly report',
        priority: 'high',
        projectId: 'project-1',
      },
      summary: { sessionId: 'session-1' },
    })
    const stateById = new Map<string, SessionLifecycleOperation>([[operation.id, operation]])
    const store = {
      withTransaction: async <T>(fn: (txStore: any, db: any) => Promise<T>) =>
        fn(store, { __mockDb: true }),
      getById: vi.fn(async (id: string) => stateById.get(id) ?? null),
      transitionStateCompareAndSet: vi.fn(async (params: {
        id: string
        fromState: SessionLifecycleOperation['state']
        toState: SessionLifecycleOperation['state']
        updatedAt: number
        appliedAt?: number | null
        resultSnapshot?: Record<string, unknown> | null
      }) => {
        const current = stateById.get(params.id)
        if (!current || current.state !== params.fromState) return false
        stateById.set(params.id, {
          ...current,
          state: params.toState,
          updatedAt: params.updatedAt,
          appliedAt: params.appliedAt ?? null,
          resultSnapshot: params.resultSnapshot ?? null,
        })
        return true
      }),
    }
    const scheduleService = {
      create: vi.fn(async () => ({
        id: 'schedule-created-1',
        name: 'Weekly report',
        description: 'from lifecycle',
        trigger: {
          time: {
            type: 'weekly',
            workMode: 'all_days',
            timezone: 'Asia/Shanghai',
            timeOfDay: '10:30',
            daysOfWeek: [1, 3, 5],
          },
        },
        action: {
          type: 'start_session',
          session: { promptTemplate: 'Generate weekly report' },
          projectId: 'project-1',
        },
        priority: 'high',
        failurePolicy: {
          maxRetries: 3,
          retryBackoff: 'exponential',
          retryDelayMs: 30_000,
          pauseAfterConsecutiveFailures: 5,
          notifyOnFailure: true,
          webhookOnFailure: false,
        },
        missedPolicy: 'skip',
        concurrencyPolicy: 'skip',
        status: 'active',
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null,
        executionCount: 0,
        consecutiveFailures: 0,
        projectId: 'project-1',
        createdAt,
        updatedAt: createdAt,
      })),
    }

    const coordinator = new LifecycleOperationCoordinator({
      store: store as any,
      scheduleService: scheduleService as any,
    })
    const result = await coordinator.confirmOperation({
      sessionId: 'session-1',
      operationId: operation.id,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('confirmed_applied')
    expect(scheduleService.create).toHaveBeenCalledTimes(1)
    expect(scheduleService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Weekly report',
        priority: 'high',
      })
    )
    expect(result.operation?.resultSnapshot?.schedule).toMatchObject({
      id: 'schedule-created-1',
      name: 'Weekly report',
    })
  })

  it('applies schedule trigger_now operation via scheduleService in confirm path', async () => {
    const operation = makeOperation({
      id: 'lop-schedule-trigger-1',
      sessionId: 'session-1',
      entity: 'schedule',
      action: 'trigger_now',
      state: 'pending_confirmation',
      normalizedPayload: {
        sessionId: 'session-1',
        id: 'schedule-1',
      },
      summary: { sessionId: 'session-1' },
    })
    const stateById = new Map<string, SessionLifecycleOperation>([[operation.id, operation]])
    const store = {
      withTransaction: async <T>(fn: (txStore: any, db: any) => Promise<T>) =>
        fn(store, { __mockDb: true }),
      getById: vi.fn(async (id: string) => stateById.get(id) ?? null),
      transitionStateCompareAndSet: vi.fn(async (params: {
        id: string
        fromState: SessionLifecycleOperation['state']
        toState: SessionLifecycleOperation['state']
        updatedAt: number
        appliedAt?: number | null
        resultSnapshot?: Record<string, unknown> | null
      }) => {
        const current = stateById.get(params.id)
        if (!current || current.state !== params.fromState) return false
        stateById.set(params.id, {
          ...current,
          state: params.toState,
          updatedAt: params.updatedAt,
          appliedAt: params.appliedAt ?? null,
          resultSnapshot: params.resultSnapshot ?? null,
        })
        return true
      }),
    }
    const execution: ScheduleExecution = {
      id: 'exec-1',
      scheduleId: 'schedule-1',
      pipelineId: null,
      pipelineStepOrder: null,
      triggerType: 'manual',
      triggerDetail: null,
      status: 'running',
      resolvedPrompt: null,
      sessionId: null,
      issueId: null,
      error: null,
      scheduledAt: Date.now(),
      startedAt: Date.now(),
      completedAt: null,
      durationMs: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    const scheduleService = {
      triggerNow: vi.fn(async () => execution),
    }

    const coordinator = new LifecycleOperationCoordinator({
      store: store as any,
      scheduleService: scheduleService as any,
    })
    const result = await coordinator.confirmOperation({
      sessionId: 'session-1',
      operationId: operation.id,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('confirmed_applied')
    expect(scheduleService.triggerNow).toHaveBeenCalledTimes(1)
    expect(scheduleService.triggerNow).toHaveBeenCalledWith('schedule-1')
    expect(result.operation?.resultSnapshot?.execution).toMatchObject({
      id: 'exec-1',
      scheduleId: 'schedule-1',
      triggerType: 'manual',
    })
  })

  it('preserves existing schedule.projectId when schedule update action does not include projectId', async () => {
    const operation = makeOperation({
      id: 'lop-schedule-update-1',
      sessionId: 'session-1',
      entity: 'schedule',
      action: 'update',
      state: 'pending_confirmation',
      normalizedPayload: {
        sessionId: 'session-1',
        id: 'schedule-1',
        action: {
          type: 'start_session',
          session: {
            promptTemplate: 'Updated prompt from lifecycle',
          },
        },
      },
      summary: { sessionId: 'session-1' },
    })

    const stateById = new Map<string, SessionLifecycleOperation>([[operation.id, operation]])
    const store = {
      withTransaction: async <T>(fn: (txStore: any, db: any) => Promise<T>) =>
        fn(store, { __mockDb: true }),
      getById: vi.fn(async (id: string) => stateById.get(id) ?? null),
      transitionStateCompareAndSet: vi.fn(async (params: {
        id: string
        fromState: SessionLifecycleOperation['state']
        toState: SessionLifecycleOperation['state']
        updatedAt: number
        appliedAt?: number | null
        resultSnapshot?: Record<string, unknown> | null
      }) => {
        const current = stateById.get(params.id)
        if (!current || current.state !== params.fromState) return false
        stateById.set(params.id, {
          ...current,
          state: params.toState,
          updatedAt: params.updatedAt,
          appliedAt: params.appliedAt ?? null,
          resultSnapshot: params.resultSnapshot ?? null,
        })
        return true
      }),
    }

    const scheduleService = {
      get: vi.fn(async () => ({
        id: 'schedule-1',
        name: 'Original schedule',
        description: '',
        trigger: { time: { type: 'daily', workMode: 'all_days', timezone: 'Asia/Shanghai', timeOfDay: '09:00' } },
        action: { type: 'start_session', session: { promptTemplate: 'Old prompt' }, projectId: 'project-1' },
        priority: 'normal',
        failurePolicy: {
          maxRetries: 3,
          retryBackoff: 'exponential',
          retryDelayMs: 30_000,
          pauseAfterConsecutiveFailures: 5,
          notifyOnFailure: true,
          webhookOnFailure: false,
        },
        missedPolicy: 'skip',
        concurrencyPolicy: 'skip',
        status: 'active',
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null,
        executionCount: 0,
        consecutiveFailures: 0,
        projectId: 'project-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      update: vi.fn(async () => ({
        id: 'schedule-1',
        name: 'Original schedule',
        description: '',
        trigger: { time: { type: 'daily', workMode: 'all_days', timezone: 'Asia/Shanghai', timeOfDay: '09:00' } },
        action: { type: 'start_session', session: { promptTemplate: 'Updated prompt from lifecycle' }, projectId: 'project-1' },
        priority: 'normal',
        failurePolicy: {
          maxRetries: 3,
          retryBackoff: 'exponential',
          retryDelayMs: 30_000,
          pauseAfterConsecutiveFailures: 5,
          notifyOnFailure: true,
          webhookOnFailure: false,
        },
        missedPolicy: 'skip',
        concurrencyPolicy: 'skip',
        status: 'active',
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null,
        executionCount: 0,
        consecutiveFailures: 0,
        projectId: 'project-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
    }

    const coordinator = new LifecycleOperationCoordinator({
      store: store as any,
      scheduleService: scheduleService as any,
    })

    const result = await coordinator.confirmOperation({
      sessionId: 'session-1',
      operationId: operation.id,
    })

    expect(result.ok).toBe(true)
    expect(result.code).toBe('confirmed_applied')
    expect(scheduleService.get).toHaveBeenCalledTimes(1)
    expect(scheduleService.update).toHaveBeenCalledTimes(1)
    expect(scheduleService.update).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({
        action: expect.objectContaining({
          projectId: 'project-1',
          session: expect.objectContaining({
            promptTemplate: 'Updated prompt from lifecycle',
          }),
        }),
      })
    )
  })
})
