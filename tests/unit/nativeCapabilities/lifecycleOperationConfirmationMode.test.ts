// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { IssueNativeCapability } from '../../../electron/nativeCapabilities/issueNativeCapability'
import { ScheduleNativeCapability } from '../../../electron/nativeCapabilities/scheduleNativeCapability'
import type {
  NativeCapabilityToolContext,
  NativeToolDescriptor,
} from '../../../electron/nativeCapabilities/types'
import type { SessionLifecycleOperationProposalInput } from '../../../src/shared/types'

function createContext(): NativeCapabilityToolContext {
  return {
    session: {
      sessionId: 'session-lifecycle-1',
      projectId: 'project-1',
      issueId: null,
      originSource: 'agent',
    },
    relay: {
      register: vi.fn(),
      unregister: vi.fn(),
      emit: vi.fn(),
    } as unknown as NativeCapabilityToolContext['relay'],
  }
}

function getToolOrThrow(tools: NativeToolDescriptor[], name: string): NativeToolDescriptor {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  return tool
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
    const tool = getToolOrThrow(capability.getToolDescriptors(createContext()), 'propose_issue_operation')

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: { title: 'Issue A' },
        confirmationMode: 'draft',
      }],
    })
    await tool.execute({ args, context: { toolUseId: 'tool-use-issue-1' } })

    expect(proposeOperations).toHaveBeenCalledTimes(1)
    const firstCall = proposeOperations.mock.calls[0][0] as {
      proposals: SessionLifecycleOperationProposalInput[]
    }
    expect(firstCall.proposals[0].confirmationMode).toBe('required')
  })

  it('accepts hyphenated schedule auto mode and normalizes it to auto_if_user_explicit', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new ScheduleNativeCapability({
      scheduleService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const tool = getToolOrThrow(capability.getToolDescriptors(createContext()), 'propose_schedule_operation')

    const args = parseToolArgs(tool, {
      operations: [{
        action: 'create',
        normalizedPayload: { name: 'Daily report' },
        confirmationMode: 'auto-if-user-explicit',
      }],
    })
    await tool.execute({ args, context: { toolUseId: 'tool-use-schedule-1' } })

    expect(proposeOperations).toHaveBeenCalledTimes(1)
    const firstCall = proposeOperations.mock.calls[0][0] as {
      proposals: SessionLifecycleOperationProposalInput[]
    }
    expect(firstCall.proposals[0].confirmationMode).toBe('auto_if_user_explicit')
  })

  it('normalizes schedule.expression and task.instruction into canonical fields', async () => {
    const proposeOperations = vi.fn().mockResolvedValue([])
    const capability = new ScheduleNativeCapability({
      scheduleService: {} as never,
      lifecycleOperationCoordinator: { proposeOperations } as never,
    })
    const tool = getToolOrThrow(capability.getToolDescriptors(createContext()), 'propose_schedule_operation')

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
    await tool.execute({ args, context: { toolUseId: 'tool-use-schedule-2' } })

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
})
