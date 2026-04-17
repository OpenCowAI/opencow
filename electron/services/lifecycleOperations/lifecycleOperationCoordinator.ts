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
  SessionLifecycleOperationAction,
  SessionLifecycleOperationEnvelope,
  SessionLifecycleOperationEntity,
  SessionLifecycleOperationProposalInput,
  SessionLifecycleOperationState,
  UpdateScheduleInput,
  UpdateIssueInput,
} from '../../../src/shared/types'
import { SessionLifecycleOperationStore } from '../sessionLifecycleOperationStore'
import { createLogger } from '../../platform/logger'
import {
  normalizeScheduleLifecycleProposalPayload,
  type ScheduleLifecycleCanonicalPayload,
} from '../../../src/shared/scheduleLifecycleCanonical'
import type { ScheduleService } from '../schedule/scheduleService'

const log = createLogger('LifecycleOperationCoordinator')

export interface ProposeLifecycleOperationsInput {
  sessionId: string
  toolUseId: string
  toolName?: string
  proposals: SessionLifecycleOperationProposalInput[]
}

export interface LifecycleOperationCoordinatorDeps {
  store: SessionLifecycleOperationStore
  executionDb?: Kysely<Database>
  scheduleService?: ScheduleService
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

interface ApplyLifecycleOperationResult {
  ok: boolean
  code: ConfirmLifecycleOperationResultCode
  operation: SessionLifecycleOperationEnvelope | null
}

interface ApplyLifecycleOperationInput {
  operationId: string
  sessionId: string
  emitLifecycleEvents?: boolean
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

export type MarkLifecycleOperationAppliedResultCode =
  | 'marked_applied_externally'
  | 'already_applied'
  | 'entity_not_found'
  | 'entity_mismatch'
  | 'rejected_concurrent'
  | 'not_found'
  | 'invalid_state'

export interface MarkLifecycleOperationAppliedResult {
  ok: boolean
  code: MarkLifecycleOperationAppliedResultCode
  operation: SessionLifecycleOperationEnvelope | null
}

interface ListSessionOperationsInput {
  sessionId: string
}

export interface SessionEntityHint {
  entity: SessionLifecycleOperationEntity
  action: SessionLifecycleOperationAction
  entityId: string
  name: string | null
}

interface ConfirmLifecycleOperationInput {
  sessionId: string
  operationId: string
}

interface RejectLifecycleOperationInput {
  sessionId: string
  operationId: string
}

interface MarkLifecycleOperationAppliedInput {
  sessionId: string
  operationId: string
  source: 'manual_form_create'
  entityRef: {
    entity: 'issue' | 'schedule'
    id: string
  }
  note?: string
}

function sanitizeLifecycleToolSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildProposalGroupKey(input: {
  toolUseId: string
  toolName?: string
}): string {
  const toolUseId = input.toolUseId.trim()
  if (!input.toolName) return toolUseId
  const sanitizedTool = sanitizeLifecycleToolSegment(input.toolName)
  if (!sanitizedTool) return toolUseId
  return `${toolUseId}#${sanitizedTool}`
}

function extractCreatedEntityId(resultSnapshot: Record<string, unknown> | null): string | null {
  if (!resultSnapshot) return null
  const issue = resultSnapshot.issue
  if (issue && typeof issue === 'object' && !Array.isArray(issue)) {
    const id = (issue as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  const schedule = resultSnapshot.schedule
  if (schedule && typeof schedule === 'object' && !Array.isArray(schedule)) {
    const id = (schedule as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
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
    createdEntityId: extractCreatedEntityId(operation.resultSnapshot),
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
  private readonly executionDb: Kysely<Database>
  private scheduleService: ScheduleService | null
  private readonly dispatch: ((event: DataBusEvent) => void) | null

  constructor(deps: LifecycleOperationCoordinatorDeps) {
    this.store = deps.store
    this.executionDb = deps.executionDb ?? deps.store.getDb()
    this.scheduleService = deps.scheduleService ?? null
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

    const proposed = await this.store.withTransaction(async (txStore) => {
      const envelopes: SessionLifecycleOperationEnvelope[] = []
      const autoApplyOperationIds: string[] = []
      const proposalGroupKey = buildProposalGroupKey({
        toolUseId: input.toolUseId,
        toolName: input.toolName,
      })

      for (let i = 0; i < input.proposals.length; i++) {
        const proposal = input.proposals[i]

        if (proposal.idempotencyKey) {
          const byIdempotency = await txStore.findByIdempotencyKey({
            sessionId: input.sessionId,
            idempotencyKey: proposal.idempotencyKey,
          })
          if (byIdempotency) {
            envelopes.push(toEnvelopeOrThrow(byIdempotency))
            continue
          }
        }

        const byTuple = await txStore.findBySessionProposalGroupOperationIndex({
          sessionId: input.sessionId,
          proposalGroupKey,
          operationIndex: i,
        })
        if (byTuple) {
          envelopes.push(toEnvelopeOrThrow(byTuple))
          continue
        }

        const now = Date.now()
        // Trust the model's declared confirmationMode — this is the single
        // intent signal. Previously a regex-based ExplicitNoConfirmDetector
        // + OperationGovernancePolicy would override the model's
        // `auto_if_user_explicit` unless the user's raw text matched one of a
        // dozen hard-coded phrases ("直接创建", "skip confirmation", …). That
        // second-guessing was anti-Agentic: the model is a strictly better
        // intent interpreter than a regex list, and the system prompt
        // already tells it exactly when to pick each mode. Tools that want
        // human-in-the-loop review can simply default to `'required'`;
        // tools that want auto-apply on explicit commands pick
        // `'auto_if_user_explicit'`. Coordinator just honors it.
        const confirmationMode = proposal.confirmationMode ?? 'required'

        const operation: SessionLifecycleOperation = {
          id: generateId(),
          sessionId: input.sessionId,
          toolUseId: input.toolUseId,
          proposalGroupKey,
          operationIndex: i,
          entity: proposal.entity,
          action: proposal.action,
          normalizedPayload: proposal.normalizedPayload,
          summary: proposal.summary ?? {},
          warnings: proposal.warnings ?? [],
          confirmationMode,
          state: 'pending_confirmation',
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

        const persisted = await txStore.upsert(operation)
        if (persisted.created) {
          this.emitLifecycleOperationUpdated(persisted.operation)
        }

        const envelope = toEnvelopeOrThrow(persisted.operation)
        envelopes.push(envelope)
        if (persisted.created && confirmationMode === 'auto_if_user_explicit') {
          autoApplyOperationIds.push(persisted.operation.id)
        }
      }

      return {
        envelopes,
        autoApplyOperationIds,
      }
    })

    if (proposed.autoApplyOperationIds.length === 0) {
      return proposed.envelopes
    }

    const envelopeMap = new Map<string, SessionLifecycleOperationEnvelope>(
      proposed.envelopes.map((item) => [item.operationId, item])
    )

    for (const operationId of proposed.autoApplyOperationIds) {
      const applied = await this.applyOperation({
        operationId,
        sessionId: input.sessionId,
        emitLifecycleEvents: true,
      })
      if (applied.operation) {
        envelopeMap.set(operationId, applied.operation)
      }
    }

    return proposed.envelopes.map((item) => envelopeMap.get(item.operationId) ?? item)
  }

  async listSessionOperations(input: ListSessionOperationsInput): Promise<SessionLifecycleOperationEnvelope[]> {
    const operations = await this.store.listBySession(input.sessionId)
    return operations.map((operation) => toEnvelope(operation)).filter((item): item is SessionLifecycleOperationEnvelope => !!item)
  }

  async getSessionEntityHints(sessionId: string): Promise<SessionEntityHint[]> {
    const operations = await this.store.listBySession(sessionId)
    const hints: SessionEntityHint[] = []
    for (const op of operations) {
      if (op.state !== 'applied') continue
      const entityId = extractCreatedEntityId(op.resultSnapshot)
      if (!entityId) continue
      const name =
        typeof op.summary.name === 'string' ? op.summary.name :
        typeof op.summary.title === 'string' ? op.summary.title : null
      hints.push({ entity: op.entity, action: op.action, entityId, name })
    }
    return hints
  }

  async confirmOperation(input: ConfirmLifecycleOperationInput): Promise<ConfirmLifecycleOperationResult> {
    const startedAt = Date.now()
    log.info('Confirm lifecycle operation started', {
      sessionId: input.sessionId,
      operationId: input.operationId,
    })
    try {
      const result = await this.applyOperation({
        operationId: input.operationId,
        sessionId: input.sessionId,
        emitLifecycleEvents: true,
      })
      log.info('Confirm lifecycle operation finished', {
        sessionId: input.sessionId,
        operationId: input.operationId,
        ok: result.ok,
        code: result.code,
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      log.error('Confirm lifecycle operation threw', {
        sessionId: input.sessionId,
        operationId: input.operationId,
        durationMs: Date.now() - startedAt,
      }, error)
      return {
        ok: false,
        code: 'invalid_state',
        operation: null,
      }
    }
  }

  private async applyOperation(params: ApplyLifecycleOperationInput): Promise<ApplyLifecycleOperationResult> {
    const { operationId, sessionId, emitLifecycleEvents = true } = params

    const begin = await this.store.withTransaction(async (txStore) => {
      const operation = await txStore.getById(operationId)
      if (!operation || operation.sessionId !== sessionId) {
        return {
          shouldExecute: false,
          result: {
            ok: false as const,
            code: 'not_found' as const,
            operation: null,
          },
          applyingOperation: null as SessionLifecycleOperation | null,
        }
      }

      if (operation.state === 'applied') {
        return {
          shouldExecute: false,
          result: {
            ok: true as const,
            code: 'already_applied' as const,
            operation: toEnvelope(operation),
          },
          applyingOperation: null as SessionLifecycleOperation | null,
        }
      }

      if (operation.state === 'failed' || operation.state === 'cancelled' || operation.state === 'applying') {
        return {
          shouldExecute: false,
          result: {
            ok: false as const,
            code: 'invalid_state' as const,
            operation: toEnvelope(operation),
          },
          applyingOperation: null as SessionLifecycleOperation | null,
        }
      }

      if (operation.state !== 'pending_confirmation') {
        return {
          shouldExecute: false,
          result: {
            ok: false as const,
            code: 'invalid_state' as const,
            operation: toEnvelope(operation),
          },
          applyingOperation: null as SessionLifecycleOperation | null,
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
            shouldExecute: false,
            result: {
              ok: true as const,
              code: 'already_applied' as const,
              operation: toEnvelope(latest),
            },
            applyingOperation: null as SessionLifecycleOperation | null,
          }
        }
        return {
          shouldExecute: false,
          result: {
            ok: false as const,
            code: 'rejected_concurrent' as const,
            operation: toEnvelope(latest),
          },
          applyingOperation: null as SessionLifecycleOperation | null,
        }
      }

      const applying = await txStore.getById(operation.id)
      if (!applying) {
        return {
          shouldExecute: false,
          result: {
            ok: false as const,
            code: 'not_found' as const,
            operation: null,
          },
          applyingOperation: null as SessionLifecycleOperation | null,
        }
      }

      return {
        shouldExecute: true,
        result: null as ApplyLifecycleOperationResult | null,
        applyingOperation: applying,
      }
    })

    if (!begin.shouldExecute || !begin.applyingOperation) {
      return begin.result ?? {
        ok: false,
        code: 'invalid_state',
        operation: null,
      }
    }

    if (emitLifecycleEvents) {
      this.emitLifecycleOperationUpdated(begin.applyingOperation)
    }

    const execution = await this.executeOperation({
      operation: begin.applyingOperation,
      db: this.resolveExecutionDb(),
    })

    const terminalState: SessionLifecycleOperationState = execution.state === 'applied' ? 'applied' : 'failed'
    const terminalCode: ConfirmLifecycleOperationResultCode =
      execution.state === 'applied' ? 'confirmed_applied' : 'invalid_state'

    const completed = await this.store.withTransaction(async (txStore) => {
      const transitioned = await txStore.transitionStateCompareAndSet({
        id: operationId,
        fromState: 'applying',
        toState: terminalState,
        updatedAt: Date.now(),
        appliedAt: execution.state === 'applied' ? execution.appliedAt : null,
        resultSnapshot: execution.resultSnapshot,
        errorCode: execution.state === 'applied' ? null : execution.errorCode,
        errorMessage: execution.state === 'applied' ? null : execution.errorMessage,
      })

      if (!transitioned) {
        const latest = await txStore.getById(operationId)
        return {
          ok: false as const,
          code: 'rejected_concurrent' as const,
          operation: toEnvelope(latest),
        }
      }

      const latest = await txStore.getById(operationId)
      return {
        ok: execution.state === 'applied',
        code: terminalCode,
        operation: toEnvelope(latest),
      }
    })

    if (emitLifecycleEvents) {
      this.emitLifecycleOperationUpdated(completed.operation)
    }

    return completed
  }

  private resolveExecutionDb(): Kysely<Database> {
    return this.executionDb
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

  async markOperationAppliedExternally(
    input: MarkLifecycleOperationAppliedInput
  ): Promise<MarkLifecycleOperationAppliedResult> {
    return this.store.withTransaction(async (txStore) => {
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

      if (operation.state !== 'pending_confirmation') {
        return {
          ok: false,
          code: 'invalid_state',
          operation: toEnvelope(operation),
        }
      }

      if (operation.entity !== input.entityRef.entity) {
        return {
          ok: false,
          code: 'entity_mismatch',
          operation: toEnvelope(operation),
        }
      }

      const entityExists = await this.verifyExternalAppliedEntityExists(input.entityRef)
      if (!entityExists) {
        return {
          ok: false,
          code: 'entity_not_found',
          operation: toEnvelope(operation),
        }
      }

      const resultSnapshot: Record<string, unknown> = {
        source: input.source,
        entityRef: {
          entity: input.entityRef.entity,
          id: input.entityRef.id,
        },
      }
      const note = this.parseNullableString(input.note)
      if (note) {
        resultSnapshot.note = note
      }

      const transitioned = await txStore.transitionStateCompareAndSet({
        id: operation.id,
        fromState: 'pending_confirmation',
        toState: 'applied',
        updatedAt: Date.now(),
        appliedAt: Date.now(),
        resultSnapshot,
        errorCode: null,
        errorMessage: null,
      })

      if (!transitioned) {
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

      const latest = await txStore.getById(operation.id)
      this.emitLifecycleOperationUpdated(latest)
      return {
        ok: true,
        code: 'marked_applied_externally',
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

    const payload = this.normalizeSchedulePayloadForExecution(operation)
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

    const trigger = this.parseScheduleTrigger(payload.trigger)
    if (!trigger) {
      return {
        state: 'failed',
        appliedAt: null,
        resultSnapshot: null,
        errorCode: 'invalid_payload',
        errorMessage: 'Schedule create payload requires a valid trigger.',
      }
    }

    const action = this.parseScheduleAction(payload.action)
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

    const payload = this.normalizeSchedulePayloadForExecution(operation)
    const scheduleId = this.resolveScheduleIdForExecution(operation, payload)
    if (!scheduleId) {
      this.logScheduleIdMissing(operation, payload)
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

    const trigger = this.parseScheduleTrigger(payload.trigger)
    if (trigger) patch.trigger = trigger

    const action = this.parseScheduleAction(payload.action)
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

    const payload = this.normalizeSchedulePayloadForExecution(operation)
    const scheduleId = this.resolveScheduleIdForExecution(operation, payload)
    if (!scheduleId) {
      this.logScheduleIdMissing(operation, payload)
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

    const payload = this.normalizeSchedulePayloadForExecution(operation)
    const scheduleId = this.resolveScheduleIdForExecution(operation, payload)
    if (!scheduleId) {
      this.logScheduleIdMissing(operation, payload)
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

    const payload = this.normalizeSchedulePayloadForExecution(operation)
    const scheduleId = this.resolveScheduleIdForExecution(operation, payload)
    if (!scheduleId) {
      this.logScheduleIdMissing(operation, payload)
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

  private normalizeSchedulePayloadForExecution(
    operation: SessionLifecycleOperation
  ): ScheduleLifecycleCanonicalPayload {
    const currentProjectId = this.parseNullableString(operation.normalizedPayload.projectId)
    const normalized = normalizeScheduleLifecycleProposalPayload(
      operation.normalizedPayload,
      {
        sessionId: operation.sessionId,
        projectId: currentProjectId === undefined ? null : currentProjectId,
        summary: operation.summary,
      }
    )

    if (!normalized.sessionId) {
      normalized.sessionId = operation.sessionId
    }

    return normalized
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

  private resolveScheduleIdForExecution(
    operation: SessionLifecycleOperation,
    payload: ScheduleLifecycleCanonicalPayload
  ): string | null {
    const payloadRecord = payload as Record<string, unknown>
    const nestedSchedule = this.asObjectRecord(payloadRecord.schedule)
    const summary = operation.summary

    return (
      this.parseRequiredId(payload.id) ??
      this.parseRequiredId(payloadRecord.scheduleId) ??
      this.parseRequiredId(nestedSchedule?.id) ??
      this.parseRequiredId(summary.id) ??
      this.parseRequiredId(summary.scheduleId) ??
      this.parseRequiredId(summary.targetId) ??
      null
    )
  }

  private logScheduleIdMissing(
    operation: SessionLifecycleOperation,
    payload: ScheduleLifecycleCanonicalPayload
  ): void {
    const payloadRecord = payload as Record<string, unknown>
    const nestedSchedule = this.asObjectRecord(payloadRecord.schedule)

    log.error('Schedule lifecycle operation missing required id', {
      operationId: operation.id,
      sessionId: operation.sessionId,
      action: operation.action,
      payloadKeys: Object.keys(payloadRecord),
      summaryKeys: Object.keys(operation.summary),
      candidateIds: {
        payloadId: this.parseRequiredId(payload.id),
        payloadScheduleId: this.parseRequiredId(payloadRecord.scheduleId),
        nestedScheduleId: this.parseRequiredId(nestedSchedule?.id),
        summaryId: this.parseRequiredId(operation.summary.id),
        summaryScheduleId: this.parseRequiredId(operation.summary.scheduleId),
        summaryTargetId: this.parseRequiredId(operation.summary.targetId),
      },
    })
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
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value.trim())
      if (Number.isFinite(parsed)) return parsed
    }
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

  private asObjectRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  }

  private parseScheduleTrigger(value: unknown): ScheduleTrigger | undefined {
    const source = this.asObjectRecord(value)
    if (!source) return undefined

    const timeNode = this.asObjectRecord(source.time)
    const eventNode = this.asObjectRecord(source.event)

    const timeSource = timeNode ?? source
    const frequency = this.parseFrequencyType(timeSource.type ?? timeSource.frequency)

    const trigger: ScheduleTrigger = {}

    if (frequency) {
      trigger.time = {
        type: frequency,
        workMode:
          timeSource.workMode === 'all_days' ||
          timeSource.workMode === 'weekdays' ||
          timeSource.workMode === 'big_small_week'
            ? timeSource.workMode
            : 'all_days',
        timezone:
          typeof timeSource.timezone === 'string' && timeSource.timezone.length > 0
            ? timeSource.timezone
            : Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeOfDay: typeof timeSource.timeOfDay === 'string' ? timeSource.timeOfDay : undefined,
        daysOfWeek: this.parseNumberArray(timeSource.daysOfWeek),
        dayOfMonth: this.parseNumber(timeSource.dayOfMonth),
        intervalMinutes: this.parseNumber(timeSource.intervalMinutes),
        cronExpression:
          typeof timeSource.cronExpression === 'string'
            ? timeSource.cronExpression
            : (typeof timeSource.cron === 'string' ? timeSource.cron : undefined),
        executeAt: this.parseTimestamp(timeSource.executeAt),
      }
    }

    const eventSource = eventNode ?? source
    const matcherType = this.parseNullableString(eventSource.matcherType ?? eventSource.eventMatcherType)
    if (matcherType) {
      const filter = this.asObjectRecord(eventSource.filter ?? eventSource.eventFilter) ?? {}
      trigger.event = {
        matcherType,
        filter,
      }
    }

    if (!trigger.time && !trigger.event) return undefined
    if (source.throttleMs !== undefined) {
      trigger.throttleMs = this.parseNumber(source.throttleMs)
    }
    return trigger
  }

  private parseScheduleAction(value: unknown): ScheduleAction | undefined {
    const source = this.asObjectRecord(value)
    if (!source) return undefined

    const actionType = this.parseActionType(source.actionType ?? source.type)
    if (!actionType) return undefined

    const action: ScheduleAction = {
      type: actionType,
    }

    const sessionNode = this.asObjectRecord(source.session)
    const promptTemplate =
      (sessionNode && typeof sessionNode.promptTemplate === 'string' ? sessionNode.promptTemplate : undefined) ??
      (typeof source.promptTemplate === 'string' ? source.promptTemplate : undefined) ??
      (typeof source.prompt === 'string' ? source.prompt : undefined)

    if (promptTemplate) {
      action.session = {
        promptTemplate,
        model:
          (sessionNode && typeof sessionNode.model === 'string' ? sessionNode.model : undefined) ??
          (typeof source.model === 'string' ? source.model : undefined),
        maxTurns:
          (sessionNode ? this.parseNumber(sessionNode.maxTurns) : undefined) ??
          this.parseNumber(source.maxTurns),
      }
    }

    const projectId = this.parseNullableString(source.projectId)
    if (projectId !== undefined) {
      action.projectId = projectId ?? undefined
    }
    if (typeof source.issueId === 'string') {
      action.issueId = source.issueId
    }
    if (source.resumeMode === 'resume_last' || source.resumeMode === 'resume_specific') {
      action.resumeMode = source.resumeMode
    }
    if (typeof source.resumeSessionId === 'string' && source.resumeSessionId.length > 0) {
      action.resumeSessionId = source.resumeSessionId
    }
    if (Array.isArray(source.contextInjections)) {
      const contextInjections = source.contextInjections.filter((item): item is NonNullable<ScheduleAction['contextInjections']>[number] =>
        item === 'git_diff_24h' ||
        item === 'git_log_week' ||
        item === 'last_execution_result' ||
        item === 'open_issues' ||
        item === 'today_stats' ||
        item === 'recent_errors' ||
        item === 'changed_files'
      )
      if (contextInjections.length > 0) {
        action.contextInjections = contextInjections
      }
    }

    return action
  }

  private async verifyExternalAppliedEntityExists(entityRef: {
    entity: 'issue' | 'schedule'
    id: string
  }): Promise<boolean> {
    if (entityRef.entity === 'schedule') {
      if (!this.scheduleService) return false
      const schedule = await this.scheduleService.get(entityRef.id)
      return !!schedule
    }

    const issueStore = new IssueStore(this.executionDb)
    const issue = await issueStore.get(entityRef.id)
    return !!issue
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
