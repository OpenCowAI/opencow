// SPDX-License-Identifier: Apache-2.0

import { getAppAPI } from '@/windowAPI'
import type {
  SessionLifecycleOperationConfirmResult,
  SessionLifecycleOperationMarkAppliedInput,
  SessionLifecycleOperationMarkAppliedResult,
  SessionLifecycleOperationRejectResult,
} from '@shared/types'

export const DEFAULT_LIFECYCLE_OPERATION_TIMEOUT_MS = 30_000

interface LifecycleOperationActionInput {
  sessionId: string
  operationId: string
  timeoutMs?: number
  timeoutMessage: string
}

export class LifecycleOperationActionTimeoutError extends Error {
  readonly code = 'lifecycle_operation_action_timeout'

  constructor(message: string) {
    super(message)
    this.name = 'LifecycleOperationActionTimeoutError'
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LifecycleOperationActionTimeoutError(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function confirmSessionLifecycleOperation(
  input: LifecycleOperationActionInput
): Promise<SessionLifecycleOperationConfirmResult> {
  return withTimeout(
    getAppAPI()['command:confirm-session-lifecycle-operation'](input.sessionId, input.operationId),
    input.timeoutMs ?? DEFAULT_LIFECYCLE_OPERATION_TIMEOUT_MS,
    input.timeoutMessage
  )
}

export async function rejectSessionLifecycleOperation(
  input: LifecycleOperationActionInput
): Promise<SessionLifecycleOperationRejectResult> {
  return withTimeout(
    getAppAPI()['command:reject-session-lifecycle-operation'](input.sessionId, input.operationId),
    input.timeoutMs ?? DEFAULT_LIFECYCLE_OPERATION_TIMEOUT_MS,
    input.timeoutMessage
  )
}

interface MarkAppliedLifecycleOperationInput extends LifecycleOperationActionInput {
  input: SessionLifecycleOperationMarkAppliedInput
}

export async function markSessionLifecycleOperationApplied(
  input: MarkAppliedLifecycleOperationInput
): Promise<SessionLifecycleOperationMarkAppliedResult> {
  return withTimeout(
    getAppAPI()['command:mark-session-lifecycle-operation-applied'](
      input.sessionId,
      input.operationId,
      input.input
    ),
    input.timeoutMs ?? DEFAULT_LIFECYCLE_OPERATION_TIMEOUT_MS,
    input.timeoutMessage
  )
}
