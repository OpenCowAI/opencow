// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { LifecycleOperationNativeCapability } from '../../../electron/nativeCapabilities/lifecycleOperationNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'
import type { LifecycleOperationCoordinator } from '../../../electron/services/lifecycleOperations'

function makeRelay(): ToolProgressRelay {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  } as unknown as ToolProgressRelay
}

function makeSessionContext(sessionId = 'session-lifecycle-1'): OpenCowSessionContext {
  return {
    sessionId,
    cwd: '/tmp',
    abortSignal: new AbortController().signal,
    projectId: null,
    issueId: null,
    originSource: 'agent',
    relay: makeRelay(),
  }
}

function makeContext(sessionContext = makeSessionContext()): NativeCapabilityToolContext {
  return {
    sessionContext,
    hostEnvironment: { activeMcpServerNames: [] },
  }
}

function makeCoordinator(overrides: Partial<LifecycleOperationCoordinator> = {}): LifecycleOperationCoordinator {
  return {
    confirmOperation: vi.fn(async () => ({
      ok: true,
      code: 'confirmed_applied' as const,
      operation: { operationId: 'op-1', state: 'applied' },
    })),
    rejectOperation: vi.fn(async () => ({
      ok: true,
      code: 'rejected' as const,
      operation: { operationId: 'op-1', state: 'cancelled' },
    })),
    ...overrides,
  } as unknown as LifecycleOperationCoordinator
}

describe('LifecycleOperationNativeCapability', () => {
  it('exposes exactly apply_lifecycle_operation and cancel_lifecycle_operation', () => {
    const capability = new LifecycleOperationNativeCapability({
      lifecycleOperationCoordinator: makeCoordinator(),
    })
    const tools = capability.getToolDescriptors(makeContext())
    const names = tools.map((t) => t.name)
    expect(names).toEqual(['apply_lifecycle_operation', 'cancel_lifecycle_operation'])
  })

  it('apply_lifecycle_operation delegates to coordinator.confirmOperation with the session id and operationId', async () => {
    const confirmOperation = vi.fn(async () => ({
      ok: true as const,
      code: 'confirmed_applied' as const,
      operation: { operationId: 'op-xyz', state: 'applied' },
    }))
    const coordinator = makeCoordinator({ confirmOperation })
    const capability = new LifecycleOperationNativeCapability({
      lifecycleOperationCoordinator: coordinator,
    })
    const session = makeSessionContext('session-apply-1')
    const [apply] = capability.getToolDescriptors(makeContext(session))

    const result = await apply.execute({
      args: { operationId: 'op-xyz' },
      sessionContext: session,
      toolUseId: 'tu-1',
      abortSignal: new AbortController().signal,
    })

    expect(confirmOperation).toHaveBeenCalledWith({
      sessionId: 'session-apply-1',
      operationId: 'op-xyz',
    })
    expect(result.isError).not.toBe(true)
    const text = (result.content as Array<{ text: string }>)[0]!.text
    expect(text).toContain('confirmed_applied')
    expect(text).toContain('op-xyz')
  })

  it('apply_lifecycle_operation returns an error when the operation is already terminal / missing', async () => {
    // This is the Agentic feedback loop: coordinator refuses (already cancelled,
    // wrong session, etc.) → tool reports a structured error so the model can
    // recover on the next turn (e.g. by calling list_schedules to re-read state).
    const confirmOperation = vi.fn(async () => ({
      ok: false as const,
      code: 'not_found' as const,
      operation: null,
    }))
    const capability = new LifecycleOperationNativeCapability({
      lifecycleOperationCoordinator: makeCoordinator({ confirmOperation }),
    })
    const [apply] = capability.getToolDescriptors(makeContext())

    const result = await apply.execute({
      args: { operationId: 'missing-op' },
      sessionContext: makeSessionContext(),
      toolUseId: 'tu-2',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ text: string }>)[0]!.text
    expect(text).toContain('not_found')
  })

  it('cancel_lifecycle_operation delegates to coordinator.rejectOperation', async () => {
    const rejectOperation = vi.fn(async () => ({
      ok: true as const,
      code: 'rejected' as const,
      operation: { operationId: 'op-cancel', state: 'cancelled' },
    }))
    const capability = new LifecycleOperationNativeCapability({
      lifecycleOperationCoordinator: makeCoordinator({ rejectOperation }),
    })
    const session = makeSessionContext('session-cancel-1')
    const [, cancel] = capability.getToolDescriptors(makeContext(session))

    const result = await cancel.execute({
      args: { operationId: 'op-cancel' },
      sessionContext: session,
      toolUseId: 'tu-3',
      abortSignal: new AbortController().signal,
    })

    expect(rejectOperation).toHaveBeenCalledWith({
      sessionId: 'session-cancel-1',
      operationId: 'op-cancel',
    })
    expect(result.isError).not.toBe(true)
  })
})
