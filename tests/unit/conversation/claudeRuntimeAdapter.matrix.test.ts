// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { adaptClaudeSdkMessage } from '../../../electron/conversation/runtime/claudeRuntimeAdapter'

describe('adaptClaudeSdkMessage routing matrix', () => {
  const routeCases: Array<{
    name: string
    message: Record<string, unknown>
    expectedKind: string
  }> = [
    {
      name: 'system:init -> session.initialized',
      message: { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-sonnet' },
      expectedKind: 'session.initialized',
    },
    {
      name: 'assistant:partial -> assistant.partial',
      message: { type: 'assistant', subtype: 'partial', message: { content: [{ type: 'text', text: 'p' }] } },
      expectedKind: 'assistant.partial',
    },
    {
      name: 'stream_event -> assistant.partial',
      message: { type: 'stream_event', message: { content: [{ type: 'text', text: 's' }] } },
      expectedKind: 'assistant.partial',
    },
    {
      name: 'assistant:tool_progress -> tool.progress',
      message: { type: 'assistant', subtype: 'tool_progress', tool_use_id: 't1', content: 'chunk' },
      expectedKind: 'tool.progress',
    },
    {
      name: 'tool_progress -> tool.progress',
      message: { type: 'tool_progress', tool_use_id: 't2', content: 'chunk' },
      expectedKind: 'tool.progress',
    },
    {
      name: 'assistant final -> assistant.final',
      message: { type: 'assistant', message: { content: [{ type: 'text', text: 'final' }] } },
      expectedKind: 'assistant.final',
    },
    {
      name: 'system:compact_boundary -> system.compact_boundary',
      message: { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 100 } },
      expectedKind: 'system.compact_boundary',
    },
    {
      name: 'system:task_started -> system.task_started',
      message: { type: 'system', subtype: 'task_started', task_id: 'task-1', description: 'run', task_type: 'job' },
      expectedKind: 'system.task_started',
    },
    {
      name: 'system:task_notification -> system.task_notification',
      message: { type: 'system', subtype: 'task_notification', task_id: 'task-1', status: 'completed', summary: 'done' },
      expectedKind: 'system.task_notification',
    },
    {
      name: 'system:hook_started -> system.hook_started',
      message: { type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'pre', hook_event: 'before_tool' },
      expectedKind: 'system.hook_started',
    },
    {
      name: 'system:hook_progress -> system.hook_progress',
      message: { type: 'system', subtype: 'hook_progress', hook_id: 'h1', output: 'hello' },
      expectedKind: 'system.hook_progress',
    },
    {
      name: 'system:hook_response -> system.hook_response',
      message: { type: 'system', subtype: 'hook_response', hook_id: 'h1', outcome: 'success', output: 'ok' },
      expectedKind: 'system.hook_response',
    },
  ]

  for (const routeCase of routeCases) {
    it(routeCase.name, () => {
      const events = adaptClaudeSdkMessage(routeCase.message as never)
      expect(events).toHaveLength(1)
      const event = events[0]!
      expect(event.kind).toBe(routeCase.expectedKind)
    })
  }

  const resultCases: Array<{
    subtype: string
    expectedOutcome: 'success' | 'max_turns' | 'execution_error' | 'budget_exceeded' | 'structured_output_error'
  }> = [
    { subtype: 'success', expectedOutcome: 'success' },
    { subtype: 'error_max_turns', expectedOutcome: 'max_turns' },
    { subtype: 'error_during_execution', expectedOutcome: 'execution_error' },
    { subtype: 'error_max_budget_usd', expectedOutcome: 'budget_exceeded' },
    { subtype: 'error_max_structured_output_retries', expectedOutcome: 'structured_output_error' },
  ]

  for (const resultCase of resultCases) {
    it(`result:${resultCase.subtype} -> turn.result(${resultCase.expectedOutcome})`, () => {
      const events = adaptClaudeSdkMessage({
        type: 'result',
        subtype: resultCase.subtype,
      } as never)

      expect(events).toHaveLength(1)
      const event = events[0]!
      expect(event.kind).toBe('turn.result')
      if (event.kind === 'turn.result') {
        expect(event.payload.outcome).toBe(resultCase.expectedOutcome)
      }
    })
  }

  it('unknown route -> protocol.violation', () => {
    const events = adaptClaudeSdkMessage({
      type: 'mystery',
      subtype: 'x',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('protocol.violation')
  })
})
