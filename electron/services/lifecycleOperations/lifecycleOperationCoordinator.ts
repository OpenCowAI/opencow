// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { generateId } from '../../shared/identity'
import { IssueStore } from '../issueStore'
import { validateSetParent } from '../../../src/shared/issueValidation'
import type { Database } from '../../database/types'
import type {
  ActionType,
  CreateScheduleInput,
  CreateIssueInput,
  DataBusEvent,
  Issue,
  IssueStatus,
  ScheduleAction,
  ScheduleFrequency,
  SchedulePriority,
  ScheduleTrigger,
  SessionLifecycleOperation,
  SessionLifecycleOperationEnvelope,
  SessionLifecycleOperationProposalInput,
  SessionLifecycleOperationState,
  UpdateScheduleInput,
  UpdateIssueInput,
} from '../../../src/shared/types'
import { SessionLifecycleOperationStore } from '../sessionLifecycleOperationStore'
import { OperationGovernancePolicy } from './operationGovernancePolicy'
import { ExplicitNoConfirmDetector } from './explicitNoConfirmDetector'
import type { ScheduleService } from '../schedule/scheduleService'

export interface ProposeLifecycleOperationsInput {
  sessionId: string
  toolUseId: string
  proposals: SessionLifecycleOperationProposalInput[]
}

export interface LifecycleOperationCoordinatorDeps {
  store: SessionLifecycleOperationStore
  scheduleService?: ScheduleService
  governancePolicy?: OperationGovernancePolicy
  noConfirmDetector?: ExplicitNoConfirmDetector
  dispatch?: (event: DataBusEvent) => void
}

interface IssueLifecycleExecutorDeps {
  db: Kysely<Database>
}

interface ExecuteLifecycleOperationResult {
  state: SessionLifecycleOperationState
  appliedAt: number | null
  resultSnapshot: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
}

export type ConfirmLifecycleOperationResultCode =
  | 'confirmed_applied'
  | 'already_applied'
  | 'rejected_concurrent'
  | 'not_found'
  | 'invalid_state'

export interface ConfirmLifecycleOperationResult {
  ok: boolean
  code: ConfirmLifecycleOperationResultCode
  operation: SessionLifecycleOperationEnvelope | null
}

export type RejectLifecycleOperationResultCode =
  | 'rejected'
  | 'already_terminal'
  | 'rejected_concurrent'
  | 'not_found'
  | 'invalid_state'

export interface RejectLifecycleOperationResult {
  ok: boolean
  code: RejectLifecycleOperationResultCode
  operation: SessionLifecycleOperationEnvelope | null
}

interface ListSessionOperationsInput {
  sessionId: string
}

interface ConfirmLifecycleOperationInput {
  sessionId: string
  operationId: string
}

interface RejectLifecycleOperationInput {
  sessionId: string
  operationId: string
}

function toEnvelope(operation: SessionLifecycleOperation | null): SessionLifecycleOperationEnvelope | null {
  if (!operation) return null
  return {
    operationId: operation.id,
    operationIndex: operation.operationIndex,
    entity: operation.entity,
    action: operation.action,
    confirmationMode: operation.confirmationMode,
    state: operation.state,
    normalizedPayload: operation.normalizedPayload,
    summary: operation.summary,
    warnings: operation.warnings,
    createdAt: new Date(operation.createdAt).toISOString(),
    updatedAt: new Date(operation.updatedAt).toISOString(),
    appliedAt: operation.appliedAt ? new Date(operation.appliedAt).toISOString() : null,
    resultSnapshot: operation.resultSnapshot,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
  }
}

function toEnvelopeOrThrow(operation: SessionLifecycleOperation): SessionLifecycleOperationEnvelope {
  const envelope = toEnvelope(operation)
  if (!envelope) {
    throw new Error('Unexpected null lifecycle operation when building envelope.')
  }
  return envelope
}

export class LifecycleOperationCoordinator {
  private readonly store: SessionLifecycleOperationStore
  private scheduleService: ScheduleService | null
  private readonly governancePolicy: OperationGovernancePolicy
  private readonly noConfirmDetector: ExplicitNoConfirmDetector
  private readonly dispatch: ((event: DataBusEvent) => void) | null

  constructor(deps: LifecycleOperationCoordinatorDeps) {
    this.store = deps.store
    this.scheduleService = deps.scheduleService ?? null
    this.governancePolicy = deps.governancePolicy ?? new OperationGovernancePolicy()
    this.noConfirmDetector = deps.noConfirmDetector ?? new ExplicitNoConfirmDetector()
    this.dispatch = deps.dispatch ?? null
  }

  setScheduleService(scheduleService: ScheduleService): void {
    this.scheduleService = scheduleService
  }

  private emitLifecycleOperationUpdated(
    operation: SessionLifecycleOperation | SessionLifecycleOperationEnvelope | null
  ): void {
    if (!this.dispatch || !operation) return
    const sessionId = 'sessionId' in operation
      ? operation.sessionId
      : (typeof operation.normalizedPayload.sessionId === 'string' ? operation.normalizedPayload.sessionId : null)
    if (!sessionId) return
    const payload = {
      sessionId,
      operationId: 'operationId' in operation ? operation.operationId : operation.id,
      entity: operation.entity,
      action: operation.action,
      state: operation.state,
    }
    this.dispatch({
      type: 'session:lifecycle-operation:updated',
      payload,
    })
  }

  async proposeOperations(input: ProposeLifecycleOperationsInput): Promise<SessionLifecycleOperationEnvelope[]> {
    if (input.proposals.length === 0) return []

    return this.store.withTransaction(async (txStore) => {
      const envelopes: SessionLifecycleOperationEnvelope[] = []

      for (let i = 0; i < input.proposals.length; i++) {
        const proposal = input.proposals[i]

        if (proposal.idempotencyKey) {
          const byIdempotency = await txStore.findByIdempotencyKey(proposal.idempotencyKey)
          if (byIdempotency) {
            envelopes.push(toEnvelopeOrThrow(byIdempotency))
            continue
          }
        }

        const byTuple = await txStore.findBySessionToolUseOperationIndex({
          sessionId: input.sessionId,
          toolUseId: input.toolUseId,
          operationIndex: i,
        })
        if (byTuple) {
          envelopes.push(toEnvelopeOrThrow(byTuple))
          continue
        }

        const now = Date.now()
        const noConfirmDetection = this.noConfirmDetector.detect(proposal.userInstruction)
        const confirmationMode = this.governancePolicy.resolveConfirmationMode({
          proposal,
          noConfirmDetection,
        })

        const state = 'pending_confirmation'

      const operation: SessionLifecycleOperation = {
        id: generateId(),
        sessionId: input.sessionId,
          toolUseId: input.toolUseId,
          operationIndex: i,
          entity: proposal.entity,
          action: proposal.action,
          normalizedPayload: proposal.normalizedPayload,
          summary: proposal.summary ?? {},
          warnings: proposal.warnings ?? [],
          confirmationMode,
          state,
          idempotencyKey: proposal.idempotencyKey ?? null,
          resultSnapshot: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
          updatedAt: now,
          appliedAt: null,
        }

        if (typeof operation.normalizedPayload.sessionId !== 'string' || operation.normalizedPayload.sessionId.length === 0) {
          operation.normalizedPayload = {
            ...operation.normalizedPayload,
            sessionId: input.sessionId,
          }
        }

        if (typeof operation.summary.sessionId !== 'string' || operation.summary.sessionId.length === 0) {
          operation.summary = {
            ...operation.summary,
            sessionId: input.sessionId,
          }
        }

        await txStore.upsert(operation)
        const envelope = toEnvelopeOrThrow(operation)
        envelopes.push(envelope)
        this.emitLifecycleOperationUpdated(envelope)
      }

      return envelopes
    })
  }

  async listSessionOperations(input: ListSessionOperationsInput): Promise<SessionLifecycleOperationEnvelope[]> {
    const operations = await this.store.listBySession(input.sessionId)
    return operations.map((operation) => toEnvelope(operation)).filter((item): item is SessionLifecycleOperationEnvelope => !!item)
  }

  async confirmOperation(input: ConfirmLifecycleOperationInput): Promise<ConfirmLifecycleOperationResult> {
    return this.store.withTransaction(async (txStore, db) => {
      const operation = await txStore.getById(input.operationId)
      if (!operation || operation.sessionId !== input.sessionId) {
        return {
          ok: false,
          code: 'not_found',
          operation: null,
        }
      }

      if (operation.state === 'applied') {
        return {
          ok: true,
          code: 'already_applied',
          operation: toEnvelope(operation),
        }
      }

      if (operation.state === 'failed' || operation.state === 'cancelled') {
        return {
          ok: false,
          code: 'invalid_state',
          operation: toEnvelope(operation),
        }
      }

      const casApplying = await txStore.transitionStateCompareAndSet({
        id: operation.id,
        fromState: 'pending_confirmation',
        toState: 'applying',
        updatedAt: Date.now(),
      })

      if (!casApplying) {
        const latest = await txStore.getById(operation.id)
        if (latest?.state === 'applied') {
          return {
            ok: true,
            code: 'already_applied',
            operation: toEnvelope(latest),
          }
        }
        return {
          ok: false,
          code: 'rejected_concurrent',
          operation: toEnvelope(latest),
        }
      }
      this.emitLifecycleOperationUpdated({
        ...operation,
        state: 'applying',
      })

      const execution = await this.executeOperation({
        operation,
        db,
      })

      if (execution.state === 'applied') {
        const casApplied = await txStore.transitionStateCompareAndSet({
          id: operation.id,
          fromState: 'applying',
          toState: 'applied',
          updatedAt: Date.now(),
          appliedAt: execution.appliedAt,
          resultSnapshot: execution.resultSnapshot,
          errorCode: null,
          errorMessage: null,
        })

        if (!casApplied) {
          const latest = await txStore.getById(operation.id)
          return {
            ok: false,
            code: 'rejected_concurrent',
            operation: toEnvelope(latest),
          }
        }

        const latest = await txStore.getById(operation.id)
        this.emitLifecycleOperationUpdated(latest)
        return {
          ok: true,
          code: 'confirmed_applied',
          operation: toEnvelope(latest),
        }
      }

      const casFailed = await txStore.transitionStateCompareAndSet({
        id: operation.id,
        fromState: 'applying',
        toState: 'failed',
        updatedAt: Date.now(),
        appliedAt: null,
        resultSnapshot: execution.resultSnapshot,
        errorCode: execution.errorCode,
        errorMessage: execution.errorMessage,
      })

      if (!casFailed) {
        const latest = await txStore.getById(operation.id)
        return {
          ok: false,
          code: 'rejected_concurrent',
          operation: toEnvelope(latest),
        }
      }

      const latest = await txStore.getById(operation.id)
      this.emitLifecycleOperationUpdated(latest)
      return {
        ok: false,
        code: 'invalid_state',
        operation: toEnvelope(latest),
      }
    })
  }

  async rejectOperation(input: RejectLifecycleOperationInput): Promise<RejectLifecycleOperationResult> {
    return this.store.withTransaction(async (txStore) => {
      const operation = await txStore.getById(input.operationId)
      if (!operation || operation.sessionId !== input.sessionId) {
        return {
          ok: false,
          code: 'not_found',
          operation: null,
        }
      }

      if (operation.state === 'cancelled' || operation.state === 'applied' || operation.state === 'failed') {
        return {
          ok: true,
          code: 'already_terminal',
          operation: toEnvelope(operation),
        }
      }

      if (operation.state !== 'pending_confirmation') {
        return {
          ok: false,
          code: 'invalid_state',
          operation: toEnvelope(operation),
        }
      }

      const ok = await txStore.transitionStateCompareAndSet({
        id: operation.id,
        fromState: 'pending_confirmation',
        toState: 'cancelled',
        updatedAt: Date.now(),
        appliedAt: null,
        resultSnapshot: operation.resultSnapshot,
        errorCode: operation.errorCode,
        errorMessage: operation.errorMessage,
      })

      if (!ok) {
        const latest = await txStore.getById(operation.id)
        if (latest?.state === 'cancelled' || latest?.state === 'applied' || latest?.state === 'failed') {
          return {
            ok: true,
            code: 'already_terminal',
            operation: toEnvelope(latest),
          }
        }
        return {
          ok: false,
          code: 'rejected_concurrent',
          operation: toEnvelope(latest),
        }
      }

      const latest = await txStore.getById(operation.id)
      this.emitLifecycleOperationUpdated(latest)
      return {
        ok: true,
        code: 'rejected',
        operation: toEnvelope(latest),
      }
    })
  }

  private async executeOperation(params: {
    operation: SessionLifecycleOperation
    db: Kysely<Database>
  }): Promise<ExecuteLifecycleOperationResult> {
    const { operation, db } = params

    if (operation.entity === 'issue') {
      return this.executeIssueOperation({
        operation,
        db,
      })
    }

    if (operation.entity === 'schedule') {
      return this.executeScheduleOperation({
        operation,
      })
    }

    return {
      state: 'failed',
      appliedAt: null,
      resultSnapshot: null,
      errorCode: 'unsupported_entity',
      errorMessage: `Unsupported lifecycle entity: ${operation.entity}`,
    }
  }

  private async executeIssueOperation(params: {
    operation: SessionLifecycleOperation
    db: Kysely<Database>
  }): Promise<ExecuteLifecycleOperationResult> {
    const { operation, db } = params
    const deps: IssueLifecycleExecutorDeps = {
      db,
    }

    try {
      switch (operation.action) {
        case 'create':
          return await this.executeIssueCreate(operation, deps)
        case 'update':
          return await this.executeIssueUpdate(operation, deps)
        case 'transition_status':
          return await this.executeIssueTransitionStatus(operation, deps)
        default:
          return {
            state: 'failed',
            appliedAt: null,
            resultSnapshot: null,
            errorCode: 'unsupported_action',
            errorMessage: `Unsupported issue lifecycle action: ${operation.action}`,
          }
      }
    } catch (err) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'execution_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async executeScheduleOperation(params: {
    operation: SessionLifecycleOperation
  }): Promise<ExecuteLifecycleOperationResult> {
    const { operation } = params
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    try {
      switch (operation.action) {
        case 'create':
          return await this.executeScheduleCreate(operation)
        case 'update':
          return await this.executeScheduleUpdate(operation)
        case 'pause':
          return await this.executeSchedulePause(operation)
        case 'resume':
          return await this.executeScheduleResume(operation)
        case 'trigger_now':
          return await this.executeScheduleTriggerNow(operation)
        default:
          return {
            state: 'failed',
            appliedAt: null,
            resultSnapshot: null,
            errorCode: 'unsupported_action',
            errorMessage: `Unsupported schedule lifecycle action: ${operation.action}`,
          }
      }
    } catch (err) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'execution_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async executeScheduleCreate(
    operation: SessionLifecycleOperation
  ): Promise<ExecuteLifecycleOperationResult> {
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    const payload = operation.normalizedPayload
    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule create payload requires a non-empty name.',
      }
    }

    const trigger = this.parseScheduleTrigger(payload)
    if (!trigger) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule create payload requires a valid trigger.',
      }
    }

    const action = this.parseScheduleAction(payload)
    if (!action) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule create payload requires a valid action.',
      }
    }

    const input: CreateScheduleInput = {
      name,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      trigger,
      action,
      priority: this.parseSchedulePriority(payload.priority),
      projectId: this.parseNullableString(payload.projectId),
    }

    const schedule = await this.scheduleService.create(input)
    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        schedule,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeScheduleUpdate(
    operation: SessionLifecycleOperation
  ): Promise<ExecuteLifecycleOperationResult> {
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    const payload = operation.normalizedPayload
    const scheduleId = this.parseRequiredId(payload.id)
    if (!scheduleId) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule update payload requires id.',
      }
    }

    const patch: UpdateScheduleInput = {}
    if (typeof payload.name === 'string') patch.name = payload.name
    if (typeof payload.description === 'string') patch.description = payload.description
    if (payload.priority !== undefined) patch.priority = this.parseSchedulePriority(payload.priority)
    if (payload.projectId !== undefined) patch.projectId = this.parseNullableString(payload.projectId)

    const trigger = this.parseScheduleTrigger(payload)
    if (trigger) patch.trigger = trigger

    const action = this.parseScheduleAction(payload)
    if (action) {
      if (action.projectId === undefined) {
        const existing = await this.scheduleService.get(scheduleId)
        if (!existing) {
          return {
            state: 'failed',
            appliedAt: null,
            resultSnapshot: null,
            errorCode: 'schedule_not_found',
            errorMessage: `Schedule not found: ${scheduleId}`,
          }
        }
        action.projectId = existing.projectId ?? undefined
      }
      patch.action = action
    }

    if (Object.keys(patch).length === 0) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule update payload has no valid patch fields.',
      }
    }

    const schedule = await this.scheduleService.update(scheduleId, patch)
    if (!schedule) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'schedule_not_found',
        errorMessage: `Schedule not found: ${scheduleId}`,
      }
    }

    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        schedule,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeSchedulePause(
    operation: SessionLifecycleOperation
  ): Promise<ExecuteLifecycleOperationResult> {
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    const payload = operation.normalizedPayload
    const scheduleId = this.parseRequiredId(payload.id)
    if (!scheduleId) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule pause payload requires id.',
      }
    }

    const schedule = await this.scheduleService.pause(scheduleId)
    if (!schedule) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'schedule_not_found',
        errorMessage: `Schedule not found: ${scheduleId}`,
      }
    }

    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        schedule,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeScheduleResume(
    operation: SessionLifecycleOperation
  ): Promise<ExecuteLifecycleOperationResult> {
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    const payload = operation.normalizedPayload
    const scheduleId = this.parseRequiredId(payload.id)
    if (!scheduleId) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule resume payload requires id.',
      }
    }

    const schedule = await this.scheduleService.resume(scheduleId)
    if (!schedule) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'schedule_not_found',
        errorMessage: `Schedule not found: ${scheduleId}`,
      }
    }

    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        schedule,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeScheduleTriggerNow(
    operation: SessionLifecycleOperation
  ): Promise<ExecuteLifecycleOperationResult> {
    if (!this.scheduleService) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'service_unavailable',
        errorMessage: 'Schedule lifecycle service is not available.',
      }
    }

    const payload = operation.normalizedPayload
    const scheduleId = this.parseRequiredId(payload.id)
    if (!scheduleId) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule trigger_now payload requires id.',
      }
    }

    const execution = await this.scheduleService.triggerNow(scheduleId)
    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        execution,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeIssueCreate(
    operation: SessionLifecycleOperation,
    deps: IssueLifecycleExecutorDeps
  ): Promise<ExecuteLifecycleOperationResult> {
    const payload = operation.normalizedPayload
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    if (!title) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Issue create payload requires a non-empty title.',
      }
    }

    const labels = Array.isArray(payload.labels)
      ? payload.labels.filter((item): item is string => typeof item === 'string')
      : []

    const input: CreateIssueInput = {
      title,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      status: this.parseIssueStatus(payload.status, false),
      priority: this.parseIssuePriority(payload.priority),
      labels,
      projectId: this.parseNullableString(payload.projectId),
      parentIssueId: this.parseNullableString(payload.parentIssueId),
      providerId: this.parseNullableString(payload.providerId),
    }

    const created = await this.createIssueWithDb(deps, input)
    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        issue: created,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeIssueUpdate(
    operation: SessionLifecycleOperation,
    deps: IssueLifecycleExecutorDeps
  ): Promise<ExecuteLifecycleOperationResult> {
    const payload = operation.normalizedPayload
    const issueId = this.parseRequiredId(payload.id)
    if (!issueId) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Issue update payload requires id.',
      }
    }

    const patch: UpdateIssueInput = {}

    if (typeof payload.title === 'string') patch.title = payload.title
    if (typeof payload.description === 'string') patch.description = payload.description
    if (payload.status !== undefined) patch.status = this.parseIssueStatus(payload.status, true)
    if (payload.priority !== undefined) patch.priority = this.parseIssuePriority(payload.priority)
    if (payload.labels !== undefined) {
      patch.labels = Array.isArray(payload.labels)
        ? payload.labels.filter((item): item is string => typeof item === 'string')
        : []
    }
    if (payload.projectId !== undefined) patch.projectId = this.parseNullableString(payload.projectId)
    if (payload.parentIssueId !== undefined) patch.parentIssueId = this.parseNullableString(payload.parentIssueId)
    if (payload.providerId !== undefined) patch.providerId = this.parseNullableString(payload.providerId)

    const updated = await this.updateIssueWithDb(deps, issueId, patch)
    if (!updated) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'issue_not_found',
        errorMessage: `Issue not found: ${issueId}`,
      }
    }

    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        issue: updated,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private async executeIssueTransitionStatus(
    operation: SessionLifecycleOperation,
    deps: IssueLifecycleExecutorDeps
  ): Promise<ExecuteLifecycleOperationResult> {
    const payload = operation.normalizedPayload
    const issueId = this.parseRequiredId(payload.id)
    const nextStatus = this.parseIssueStatus(payload.toStatus ?? payload.status, true)

    if (!issueId || !nextStatus) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Issue transition payload requires id and target status.',
      }
    }

    const updated = await this.updateIssueWithDb(deps, issueId, { status: nextStatus })
    if (!updated) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'issue_not_found',
        errorMessage: `Issue not found: ${issueId}`,
      }
    }

    return {
      state: 'applied',
      appliedAt: Date.now(),
      resultSnapshot: {
        issue: updated,
      },
      errorCode: null,
      errorMessage: null,
    }
  }

  private parseNullableString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    return typeof value === 'string' ? value : undefined
  }

  private parseRequiredId(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const id = value.trim()
    return id.length > 0 ? id : null
  }

  private parseIssueStatus(value: unknown, allowUndefined: boolean): IssueStatus | undefined {
    if (value === undefined && allowUndefined) return undefined
    if (typeof value !== 'string') return allowUndefined ? undefined : 'backlog'
    const normalized = value as IssueStatus
    if (
      normalized === 'backlog' ||
      normalized === 'todo' ||
      normalized === 'in_progress' ||
      normalized === 'done' ||
      normalized === 'cancelled'
    ) {
      return normalized
    }
    return allowUndefined ? undefined : 'backlog'
  }

  private parseIssuePriority(value: unknown): 'urgent' | 'high' | 'medium' | 'low' | undefined {
    if (value === undefined) return undefined
    if (typeof value !== 'string') return undefined
    if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') return value
    return undefined
  }

  private parseNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    return undefined
  }

  private parseTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
      const parsed = new Date(value).getTime()
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  private parseNumberArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined
    const out = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    return out.length > 0 ? out : undefined
  }

  private parseSchedulePriority(value: unknown): SchedulePriority | undefined {
    if (typeof value !== 'string') return undefined
    if (value === 'critical' || value === 'high' || value === 'normal' || value === 'low') return value
    return undefined
  }

  private parseFrequencyType(value: unknown): ScheduleFrequency['type'] | undefined {
    if (typeof value !== 'string') return undefined
    if (
      value === 'once' ||
      value === 'interval' ||
      value === 'daily' ||
      value === 'weekly' ||
      value === 'biweekly' ||
      value === 'monthly' ||
      value === 'cron'
    ) {
      return value
    }
    return undefined
  }

  private parseActionType(value: unknown): ActionType | undefined {
    if (typeof value !== 'string') return undefined
    if (
      value === 'start_session' ||
      value === 'resume_session' ||
      value === 'create_issue' ||
      value === 'webhook' ||
      value === 'notification'
    ) {
      return value
    }
    return undefined
  }

  private parseScheduleTrigger(payload: Record<string, unknown>): ScheduleTrigger | undefined {
    const nested = payload.trigger
    if (nested && typeof nested === 'object') {
      return nested as ScheduleTrigger
    }

    const frequency = this.parseFrequencyType(payload.frequency)
    const eventMatcherType = this.parseNullableString(payload.eventMatcherType)

    if (!frequency && !eventMatcherType) return undefined

    const trigger: ScheduleTrigger = {}
    if (frequency) {
      trigger.time = {
        type: frequency,
        workMode:
          payload.workMode === 'all_days' ||
          payload.workMode === 'weekdays' ||
          payload.workMode === 'big_small_week'
            ? payload.workMode
            : 'all_days',
        timezone:
          typeof payload.timezone === 'string' && payload.timezone.length > 0
            ? payload.timezone
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeOfDay: typeof payload.timeOfDay === 'string' ? payload.timeOfDay : undefined,
        daysOfWeek: this.parseNumberArray(payload.daysOfWeek),
        dayOfMonth: this.parseNumber(payload.dayOfMonth),
        intervalMinutes: this.parseNumber(payload.intervalMinutes),
        cronExpression: typeof payload.cronExpression === 'string' ? payload.cronExpression : undefined,
        executeAt: this.parseTimestamp(payload.executeAt),
      }
    }
    if (eventMatcherType) {
      trigger.event = {
        matcherType: eventMatcherType,
        filter: typeof payload.eventFilter === 'object' && payload.eventFilter !== null
          ? payload.eventFilter as Record<string, unknown>
          : {},
      }
    }

    return trigger
  }

  private parseScheduleAction(payload: Record<string, unknown>): ScheduleAction | undefined {
    const nested = payload.action
    if (nested && typeof nested === 'object') {
      const action = {
        ...(nested as ScheduleAction),
      }
      const payloadProjectId = this.parseNullableString(payload.projectId)
      if (action.projectId === undefined && payloadProjectId !== undefined) {
        action.projectId = payloadProjectId ?? undefined
      }
      if (action.issueId === undefined && typeof payload.issueId === 'string') {
        action.issueId = payload.issueId
      }
      return action
    }

    const actionType = this.parseActionType(payload.actionType ?? payload.type)
    const promptTemplate = typeof payload.prompt === 'string' ? payload.prompt : undefined

    if (!actionType && !promptTemplate) return undefined

    const action: ScheduleAction = {
      type: actionType ?? 'start_session',
    }

    if (promptTemplate) {
      action.session = {
        promptTemplate,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        maxTurns: this.parseNumber(payload.maxTurns),
      }
    }
    const projectId = this.parseNullableString(payload.projectId)
    if (projectId !== undefined) {
      action.projectId = projectId ?? undefined
    }
    if (typeof payload.issueId === 'string') {
      action.issueId = payload.issueId
    }
    return action
  }

  private async createIssueWithDb(
    deps: IssueLifecycleExecutorDeps,
    input: CreateIssueInput
  ): Promise<Issue> {
    const store = new IssueStore(deps.db)
    const now = Date.now()

    const parentIssueId = input.parentIssueId ?? null
    let inheritedProjectId = input.projectId ?? null

    if (parentIssueId) {
      const parent = await store.get(parentIssueId)
      if (!parent) {
        throw new Error(`Parent issue not found: ${parentIssueId}`)
      }
      if (parent.parentIssueId) {
        throw new Error('Cannot create sub-issue of a sub-issue (only single-level nesting is supported)')
      }
      if (parent.status === 'done') {
        throw new Error('Cannot add sub-issues to a completed (Done) issue')
      }
      if (inheritedProjectId === null) {
        inheritedProjectId = parent.projectId
      }
    }

    const issue: Issue = {
      id: generateId(),
      title: input.title,
      description: input.description ?? '',
      richContent: input.richContent ?? null,
      status: input.status ?? 'backlog',
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      projectId: inheritedProjectId,
      sessionId: input.sessionId ?? null,
      sessionHistory: [],
      parentIssueId,
      images: input.images ?? [],
      createdAt: now,
      updatedAt: now,
      readAt: now,
      lastAgentActivityAt: null,
      contextRefs: [],
      providerId: input.providerId ?? null,
      remoteNumber: null,
      remoteUrl: null,
      remoteState: null,
      remoteSyncedAt: null,
      assignees: null,
      milestone: null,
      syncStatus: null,
      remoteUpdatedAt: null,
    }

    await store.add(issue)
    await store.syncLabels(issue.labels)
    if (this.dispatch) {
      this.dispatch({ type: 'issues:invalidated', payload: {} })
    }
    return issue
  }

  private async updateIssueWithDb(
    deps: IssueLifecycleExecutorDeps,
    id: string,
    patch: UpdateIssueInput
  ): Promise<Issue | null> {
    const store = new IssueStore(deps.db)

    if (patch.parentIssueId !== undefined && patch.parentIssueId !== null) {
      const [source, target, sourceChildren] = await Promise.all([
        store.get(id),
        store.get(patch.parentIssueId),
        store.listChildren(id),
      ])

      const result = validateSetParent({
        sourceId: id,
        targetId: patch.parentIssueId,
        source,
        target,
        sourceHasChildren: sourceChildren.length > 0,
      })
      if (!result.valid) {
        throw new Error(`Invalid parent-child relationship: ${result.error}`)
      }
    }

    const updated = await store.update(id, patch)
    if (updated && patch.labels && patch.labels.length > 0) {
      await store.syncLabels(patch.labels)
    }

    if (updated && this.dispatch) {
      this.dispatch({ type: 'issues:invalidated', payload: {} })
    }
    return updated
  }
}
