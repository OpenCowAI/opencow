// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { SessionLifecycleOperationEnvelope } from '../../../src/shared/types'
import { mapScheduleOperationToParsedDraft } from '../../../src/renderer/lib/lifecycleOperationDraftMapper'

function makeScheduleOperation(
  normalizedPayload: Record<string, unknown>,
  summary: Record<string, unknown> = {}
): SessionLifecycleOperationEnvelope {
  return {
    operationId: 'lop-1',
    operationIndex: 0,
    entity: 'schedule',
    action: 'create',
    confirmationMode: 'required',
    state: 'pending_confirmation',
    normalizedPayload,
    summary,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    appliedAt: null,
    resultSnapshot: null,
    errorCode: null,
    errorMessage: null,
  }
}

describe('mapScheduleOperationToParsedDraft', () => {
  it('maps legacy title + schedule/task payload into parsed draft', () => {
    const operation = makeScheduleOperation(
      {
        sessionId: 'session-1',
        title: '每日 AI Agent 热门话题查询',
        schedule: {
          type: 'cron',
          expression: '40 9 * * *',
          timezone: 'Asia/Shanghai',
        },
        task: {
          instruction: '查询 AI Agent 热门话题',
        },
      },
      {
        sessionId: 'session-1',
      }
    )

    const parsed = mapScheduleOperationToParsedDraft(operation)

    expect(parsed).toEqual(
      expect.objectContaining({
        name: '每日 AI Agent 热门话题查询',
        frequency: 'cron',
        cronExpression: '40 9 * * *',
        prompt: '查询 AI Agent 热门话题',
        priority: 'normal',
      })
    )
  })

  it('maps canonical trigger/action payload into parsed draft', () => {
    const operation = makeScheduleOperation(
      {
        sessionId: 'session-1',
        name: 'Daily agent topics',
        description: 'Daily at 09:40',
        priority: 'high',
        trigger: {
          time: {
            type: 'daily',
            timezone: 'Asia/Shanghai',
            workMode: 'all_days',
            timeOfDay: '09:40',
          },
        },
        action: {
          type: 'start_session',
          session: {
            promptTemplate: 'Query AI agent hot topics',
            systemPrompt: 'Always prioritize safety checks.',
          },
          projectId: 'project-1',
        },
      }
    )

    const parsed = mapScheduleOperationToParsedDraft(operation)

    expect(parsed).toEqual(
      expect.objectContaining({
        name: 'Daily agent topics',
        description: 'Daily at 09:40',
        frequency: 'daily',
        timeOfDay: '09:40',
        prompt: 'Query AI agent hot topics',
        systemPrompt: 'Always prioritize safety checks.',
        priority: 'high',
        projectId: 'project-1',
      })
    )
  })

  it('prefers summary projectId when payload omits projectId', () => {
    const operation = makeScheduleOperation(
      {
        sessionId: 'session-1',
        name: 'Daily agent topics',
        trigger: {
          time: {
            type: 'daily',
            timezone: 'Asia/Shanghai',
            workMode: 'all_days',
            timeOfDay: '09:40',
          },
        },
        action: {
          type: 'start_session',
          session: {
            promptTemplate: 'Query AI agent hot topics',
          },
        },
      },
      {
        sessionId: 'session-1',
        projectId: 'project-summary-1',
      }
    )

    const parsed = mapScheduleOperationToParsedDraft(operation)
    expect(parsed?.projectId).toBe('project-summary-1')
  })
})
