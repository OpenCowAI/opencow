// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { IssueNativeCapability } from '../../../electron/nativeCapabilities/issueNativeCapability'
import { ScheduleNativeCapability } from '../../../electron/nativeCapabilities/scheduleNativeCapability'
import type {
  NativeCapabilityToolContext,
  NativeToolDescriptor,
} from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'
import type { SessionLifecycleOperationProposalInput } from '../../../src/shared/types'

function makeRelay(): ToolProgressRelay {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  } as unknown as ToolProgressRelay
}

function createSessionContext(): OpenCowSessionContext {
  return {
    sessionId: 'session-lifecycle-1',
    cwd: '/tmp',
    abortSignal: new AbortController().signal,
    projectId: 'project-1',
    issueId: null,
    originSource: 'agent',
    relay: makeRelay(),
  }
}

function createContext(sessionContext = createSessionContext()): NativeCapabilityToolContext {
  return {
    sessionContext,
    hostEnvironment: { activeMcpServerNames: [] },
  }
}

function getToolOrThrow(
  tools: readonly NativeToolDescriptor[],
  name: string,
): NativeToolDescriptor {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  return tool
}

/**
 * Phase 1B.11 helper: invoke a descriptor's execute with the new SDK shape
 * (`args + sessionContext + toolUseId + abortSignal`). The legacy
 * `tool.execute({args, context})` shape no longer exists.
 */
async function callTool(
  tool: NativeToolDescriptor,
  args: Record<string, unknown>,
  options: { sessionContext: OpenCowSessionContext; toolUseId?: string } = {
    sessionContext: createSessionContext(),
  },
) {
  return tool.execute({
    args,
    sessionContext: options.sessionContext,
    toolUseId: options.toolUseId ?? `tool-use-${Math.random().toString(36).slice(2, 10)}`,
    abortSignal: new AbortController().signal,
  })
}

function parseToolArgs(
  tool: NativeToolDescriptor,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = z.object(tool.inputSchema).safeParse(input)
  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new Error(parsed.error.message)
  return parsed.data as Record<string, unknown>
}

describe('Lifecycle operation confirmationMode normalization', () => {
  it('accepts legacy issue confirmationMode=draft and normalizes it to required', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new IssueNativeCapability({
      issueService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const sessionContext = createSessionContext()
    const tool = getToolOrThrow(
      capability.getToolDescriptors(createContext(sessionContext)),
      'propose_issue_operation',
    )

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: { title: 'Issue A' },
        confirmationMode: 'draft',
      }],
    })
    await callTool(tool, args, { sessionContext, toolUseId: 'tool-use-issue-1' })

    expect(proposeOperations).toHaveBeenCalledTimes(1)
    const firstCall = proposeOperations.mock.calls[0][0] as {
      toolName: string
      proposals: SessionLifecycleOperationProposalInput[]
    }
    expect(firstCall.toolName).toBe('propose_issue_operation')
    expect(firstCall.proposals[0].confirmationMode).toBe('required')
  })

  it('accepts hyphenated schedule auto mode and normalizes it to auto_if_user_explicit', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new ScheduleNativeCapability({
      scheduleService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const sessionContext = createSessionContext()
    const tool = getToolOrThrow(
      capability.getToolDescriptors(createContext(sessionContext)),
      'propose_schedule_operation',
    )

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: { name: 'Daily report' },
        confirmationMode: 'auto-if-user-explicit',
      }],
    })
    await callTool(tool, args, { sessionContext, toolUseId: 'tool-use-schedule-1' })

    expect(proposeOperations).toHaveBeenCalledTimes(1)
    const firstCall = proposeOperations.mock.calls[0][0] as {
      toolName: string
      proposals: SessionLifecycleOperationProposalInput[]
    }
    expect(firstCall.toolName).toBe('propose_schedule_operation')
    expect(firstCall.proposals[0].confirmationMode).toBe('auto_if_user_explicit')
  })

  it('normalizes schedule.expression and task.instruction into canonical fields', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new ScheduleNativeCapability({
      scheduleService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const sessionContext = createSessionContext()
    const tool = getToolOrThrow(
      capability.getToolDescriptors(createContext(sessionContext)),
      'propose_schedule_operation',
    )

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: {
          schedule: {
            type: 'cron',
            expression: '40 9 * * *',
            timezone: 'Asia/Shanghai',
          },
          task: {
            instruction: '查询 AI Agent 热门话题',
            locale: 'zh-CN',
          },
        },
      }],
    })
    await callTool(tool, args, { sessionContext, toolUseId: 'tool-use-schedule-2' })

    expect(proposeOperations).toHaveBeenCalledTimes(1)
    const firstCall = proposeOperations.mock.calls[0][0] as {
      proposals: SessionLifecycleOperationProposalInput[]
    }
    expect(firstCall.proposals[0].normalizedPayload).toEqual(
      expect.objectContaining({
        sessionId: 'session-lifecycle-1',
        name: '查询 AI Agent 热门话题',
        trigger: expect.objectContaining({
          time: expect.objectContaining({
            type: 'cron',
            cronExpression: '40 9 * * *',
            timezone: 'Asia/Shanghai',
          }),
        }),
        action: expect.objectContaining({
          type: 'start_session',
          session: expect.objectContaining({
            promptTemplate: '查询 AI Agent 热门话题',
          }),
          projectId: 'project-1',
        }),
      }),
    )
  })

  it('forwards the framework-supplied toolUseId verbatim into the lifecycle proposal', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new IssueNativeCapability({
      issueService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const sessionContext = createSessionContext()
    const tool = getToolOrThrow(
      capability.getToolDescriptors(createContext(sessionContext)),
      'propose_issue_operation',
    )

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: { title: 'Issue A' },
      }],
    })

    // The SDK adapter layer guarantees a non-empty toolUseId in production
    // (it generates a UUID when none is supplied), so the OpenCow native
    // capability just forwards whatever it receives.
    await callTool(tool, args, { sessionContext, toolUseId: 'tool-use-aaa' })
    await callTool(tool, args, { sessionContext, toolUseId: 'tool-use-bbb' })

    expect(proposeOperations).toHaveBeenCalledTimes(2)
    const first = proposeOperations.mock.calls[0][0] as { toolUseId: string }
    const second = proposeOperations.mock.calls[1][0] as { toolUseId: string }
    expect(first.toolUseId).toBe('tool-use-aaa')
    expect(second.toolUseId).toBe('tool-use-bbb')
  })
})
