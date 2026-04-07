// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { normalizeScheduleLifecycleProposalPayload } from '../../../src/shared/scheduleLifecycleCanonical'

describe('normalizeScheduleLifecycleProposalPayload', () => {
  it('normalizes schedule.expression + task.instruction into canonical trigger/action', () => {
    const payload = normalizeScheduleLifecycleProposalPayload(
      {
        title: '每日 AI Agent 热门话题查询',
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
      {
        sessionId: 'session-1',
        projectId: 'project-1',
      }
    )

    expect(payload).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        name: '每日 AI Agent 热门话题查询',
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
      })
    )
  })

  it('does not inject top-level projectId unless explicitly provided', () => {
    const payload = normalizeScheduleLifecycleProposalPayload(
      {
        name: 'Daily report',
        trigger: {
          time: {
            type: 'daily',
            timezone: 'Asia/Shanghai',
            workMode: 'all_days',
            timeOfDay: '09:30',
          },
        },
        action: {
          type: 'start_session',
          session: {
            promptTemplate: 'Generate report',
          },
        },
      },
      {
        sessionId: 'session-1',
        projectId: null,
      }
    )

    expect(payload.projectId).toBeUndefined()
    expect(payload.action).toEqual(
      expect.objectContaining({
        projectId: undefined,
      })
    )
  })

  it('honors explicit projectId null and keeps action.projectId detached', () => {
    const payload = normalizeScheduleLifecycleProposalPayload(
      {
        name: 'Detached schedule',
        projectId: null,
        trigger: {
          time: {
            type: 'daily',
            timezone: 'Asia/Shanghai',
            workMode: 'all_days',
            timeOfDay: '09:30',
          },
        },
        action: {
          type: 'start_session',
          session: {
            promptTemplate: 'Generate report',
          },
        },
      },
      {
        sessionId: 'session-1',
        projectId: 'project-1',
      }
    )

    expect(payload.projectId).toBeNull()
    expect(payload.action).toEqual(
      expect.objectContaining({
        projectId: undefined,
      })
    )
  })
})
