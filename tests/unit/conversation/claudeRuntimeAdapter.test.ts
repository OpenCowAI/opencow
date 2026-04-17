// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { adaptClaudeSdkMessage } from '../../../electron/conversation/runtime/claudeRuntimeAdapter'

describe('adaptClaudeSdkMessage', () => {
  it('maps system init into session.initialized', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      model: 'claude-sonnet',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('session.initialized')
    if (event.kind === 'session.initialized') {
      expect(event.payload.sessionRef).toBe('sess-1')
      expect(event.payload.model).toBe('claude-sonnet')
    }
  })

  it('maps partial assistant blocks', () => {
    const events = adaptClaudeSdkMessage({
      type: 'assistant',
      subtype: 'partial',
      message: {
        content: [{ type: 'text', text: 'hello' }],
      },
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('assistant.partial')
    if (event.kind === 'assistant.partial') {
      expect(event.payload.blocks).toEqual([{ type: 'text', text: 'hello' }])
    }
  })

  it('maps result success with modelUsage — no turn.usage emitted from result', () => {
    const events = adaptClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      model_usage: {
        claude: {
          input_tokens: 10,
          output_tokens: 2,
          context_window: 1_000_000,
          max_output_tokens: 64_000,
        },
      },
      total_cost_usd: 0.12,
    } as never)

    // Only turn.result — result.usage is NOT emitted as turn.usage
    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('turn.result')
    if (event.kind === 'turn.result') {
      expect(event.payload.outcome).toBe('success')
      expect(event.payload.modelUsage?.claude.inputTokens).toBe(10)
      expect(event.payload.modelUsage?.claude.outputTokens).toBe(2)
      expect(event.payload.modelUsage?.claude.contextWindow).toBe(1_000_000)
      expect(event.payload.modelUsage?.claude.maxOutputTokens).toBe(64_000)
      expect(event.payload.costUsd).toBe(0.12)
    }
  })

  it('result with top-level usage does NOT emit turn.usage (cumulative data excluded)', () => {
    const events = adaptClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: 8_000,
        output_tokens: 1_200,
        cache_read_input_tokens: 30_000,
        cache_creation_input_tokens: 5_000,
      },
      model_usage: {
        'claude-sonnet-4-20250514': {
          input_tokens: 8_000,
          output_tokens: 1_200,
          context_window: 200_000,
        },
      },
      total_cost_usd: 0.05,
    } as never)

    // result.usage is cumulative — must NOT be emitted as turn.usage to avoid
    // overwriting the correct per-API-call context window size from assistant messages.
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('turn.result')
  })

  it('emits turn.usage AND context.snapshot from assistant final message usage', () => {
    const events = adaptClaudeSdkMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'final' }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 1,
        },
      },
    } as never)

    expect(events.map((event) => event.kind)).toEqual([
      'assistant.final',
      'turn.usage',
      'context.snapshot',
    ])

    const usageEvent = events.find((event) => event.kind === 'turn.usage')
    expect(usageEvent?.kind).toBe('turn.usage')
    if (usageEvent?.kind === 'turn.usage') {
      expect(usageEvent.payload).toEqual({
        inputTokens: 10,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 1,
      })
    }

    const snapshotEvent = events.find((event) => event.kind === 'context.snapshot')
    expect(snapshotEvent?.kind).toBe('context.snapshot')
    if (snapshotEvent?.kind === 'context.snapshot') {
      // Context window = input + cache_read + cache_creation = 10 + 3 + 1 = 14
      expect(snapshotEvent.payload.usedTokens).toBe(14)
      expect(snapshotEvent.payload.limitTokens).toBeNull()
      expect(snapshotEvent.payload.remainingTokens).toBeNull()
      expect(snapshotEvent.payload.remainingPct).toBeNull()
      expect(snapshotEvent.payload.source).toBe('claude.assistant_usage')
      expect(snapshotEvent.payload.confidence).toBe('estimated')
    }
  })

  it('maps task_started system event', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      description: 'collect files',
      task_type: 'search',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('system.task_started')
    if (event.kind === 'system.task_started') {
      expect(event.payload.taskId).toBe('task-1')
      expect(event.payload.toolUseId).toBe('tool-1')
      expect(event.payload.description).toBe('collect files')
      expect(event.payload.taskType).toBe('search')
    }
  })

  it('maps system:status compacting to engine.diagnostic info', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'uuid-1',
      session_id: 'sess-1',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('engine.diagnostic')
    if (event.kind === 'engine.diagnostic') {
      expect(event.payload.code).toBe('claude.status.compacting')
      expect(event.payload.severity).toBe('info')
      expect(event.payload.terminal).toBe(false)
    }
  })

  it('silently drops system:status with null status (normal state)', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'status',
      status: null,
      uuid: 'uuid-2',
      session_id: 'sess-1',
    } as never)

    expect(events).toHaveLength(0)
  })

  it('silently drops system:files_persisted', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'files_persisted',
      uuid: 'uuid-3',
      session_id: 'sess-1',
    } as never)

    expect(events).toHaveLength(0)
  })

  it('silently drops pure user prompt-echo messages (string or text-only)', () => {
    // String content — pure echo of the just-sent prompt.
    expect(adaptClaudeSdkMessage({
      type: 'user',
      message: { content: 'hello' },
    } as never)).toHaveLength(0)

    // Array of text-only blocks — also a pure echo, no tool_result envelope.
    expect(adaptClaudeSdkMessage({
      type: 'user',
      message: { content: [{ type: 'text', text: 'hello' }] },
    } as never)).toHaveLength(0)
  })

  it('emits user.tool_result with extracted media for browser_screenshot replay', () => {
    // Bug repro: the browser_screenshot tool returns its PNG via a user-role
    // tool_result block in MCP native shape (data + mimeType).  Previously the
    // adapter dropped the entire user message so the image never reached
    // persistence — and on the next turn the model would say it had not seen
    // the screenshot.
    const events = adaptClaudeSdkMessage({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-shot',
            content: [
              { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            ],
          },
        ],
      },
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('user.tool_result')
    if (event.kind !== 'user.tool_result') return
    expect(event.payload.toolUseId).toBe('tool-shot')
    expect(event.payload.isError).toBe(false)
    // ToolResultBlock + provenance-stamped ImageBlock (toolUseId carried
    // end-to-end so renderer's BrowserScreenshotCard can light up).
    expect(event.payload.blocks).toEqual([
      { type: 'tool_result', toolUseId: 'tool-shot', content: '' },
      {
        type: 'image',
        mediaType: 'image/png',
        data: 'iVBORw0KGgo=',
        sizeBytes: Math.ceil((12 * 3) / 4),
        toolUseId: 'tool-shot',
      },
    ])
  })

  it('flags malformed tool_result missing tool_use_id as protocol.violation', () => {
    const events = adaptClaudeSdkMessage({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', content: 'orphan' }],
      },
    } as never)

    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('protocol.violation')
  })

  it('gracefully ignores unknown event types (forward-compatible)', () => {
    const events = adaptClaudeSdkMessage({
      type: 'unknown_event',
      subtype: 'mystery',
    } as never)

    expect(events).toHaveLength(0)
  })

  it('fail-closes unknown result subtype with subtype context', () => {
    const events = adaptClaudeSdkMessage({
      type: 'result',
      subtype: 'weird_subtype',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('protocol.violation')
    if (event.kind === 'protocol.violation') {
      expect(event.payload.rawType).toBe('result')
      expect(event.payload.rawSubtype).toBe('weird_subtype')
    }
  })

  it('maps hook_progress output from stdout/stderr fallback', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'hook_progress',
      hook_id: 'h1',
      stdout: 'hello ',
      stderr: 'world',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('system.hook_progress')
    if (event.kind === 'system.hook_progress') {
      expect(event.payload.hookId).toBe('h1')
      expect(event.payload.output).toBe('hello world')
    }
  })

  it('fail-closes malformed task_notification payload', () => {
    const events = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      status: 'completed',
      summary: '',
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('protocol.violation')
  })

  it('fail-closes malformed hook payloads', () => {
    const hookStartedEvents = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'hook_started',
      hook_id: '',
      hook_name: 'pre_tool',
      hook_event: 'before',
    } as never)
    const hookStarted = hookStartedEvents[0]!
    expect(hookStarted.kind).toBe('protocol.violation')

    const hookResponseEvents = adaptClaudeSdkMessage({
      type: 'system',
      subtype: 'hook_response',
      hook_id: 'h1',
      outcome: 'success',
      output: '',
    } as never)
    const hookResponse = hookResponseEvents[0]!
    expect(hookResponse.kind).toBe('protocol.violation')
  })

  it('fail-closes malformed result.errors payload', () => {
    const events = adaptClaudeSdkMessage({
      type: 'result',
      subtype: 'success',
      errors: ['ok', 123],
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('protocol.violation')
  })

  // --- Extended thinking block ordering (SDK quirk compensation) ---

  it('reorders thinking blocks before text in partial events (SDK extended thinking quirk)', () => {
    const events = adaptClaudeSdkMessage({
      type: 'assistant',
      subtype: 'partial',
      message: {
        content: [
          { type: 'text', text: 'Here is my answer.' },
          { type: 'thinking', thinking: 'Let me reason about this...' },
        ],
      },
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    expect(event.kind).toBe('assistant.partial')
    if (event.kind === 'assistant.partial') {
      expect(event.payload.blocks.map((b) => b.type)).toEqual(['thinking', 'text'])
    }
  })

  it('reorders thinking blocks before text in final assistant events', () => {
    const events = adaptClaudeSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Done.' },
          { type: 'thinking', thinking: 'analysis...' },
        ],
      },
    } as never)

    const finalEvent = events.find((e) => e.kind === 'assistant.final')!
    expect(finalEvent.kind).toBe('assistant.final')
    if (finalEvent.kind === 'assistant.final') {
      expect(finalEvent.payload.blocks.map((b) => b.type)).toEqual(['thinking', 'text'])
    }
  })

  it('preserves correct order when thinking already comes first', () => {
    const events = adaptClaudeSdkMessage({
      type: 'assistant',
      subtype: 'partial',
      message: {
        content: [
          { type: 'thinking', thinking: 'reasoning...' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as never)

    expect(events).toHaveLength(1)
    const event = events[0]!
    if (event.kind === 'assistant.partial') {
      expect(event.payload.blocks.map((b) => b.type)).toEqual(['thinking', 'text'])
    }
  })
})
