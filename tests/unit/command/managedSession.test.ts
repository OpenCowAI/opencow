// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { ManagedSession } from '../../../electron/command/managedSession'
import type { ManagedSessionConfig, ContentBlock, TaskStartedEvent, HookStatusEvent } from '../../../src/shared/types'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown> = {}): ContentBlock {
  return { type: 'tool_use', id, name, input }
}

describe('ManagedSession', () => {
  const baseConfig: ManagedSessionConfig = {
    prompt: 'Fix the auth bug',
    origin: { source: 'issue', issueId: 'issue-1' },
    projectPath: '/tmp/test-project'
  }

  it('starts in creating state', () => {
    const session = new ManagedSession(baseConfig)
    const info = session.getInfo()
    expect(info.state).toBe('creating')
    expect(info.origin).toEqual({ source: 'issue', issueId: 'issue-1' })
    expect(info.messages).toHaveLength(0)
  })

  it('getInfo returns serializable snapshot', () => {
    const session = new ManagedSession(baseConfig)
    const info = session.getInfo()

    expect(info).toHaveProperty('id')
    expect(info).toHaveProperty('state')
    expect(info).toHaveProperty('origin')
    expect(info).toHaveProperty('projectPath')
    expect(info).toHaveProperty('model')
    expect(info).toHaveProperty('messages')
    expect(info).toHaveProperty('createdAt')
    expect(info).toHaveProperty('lastActivity')
    expect(info).toHaveProperty('totalCostUsd')
    expect(info).toHaveProperty('error')

    expect(() => JSON.stringify(info)).not.toThrow()
  })

  it('addMessage stores ContentBlock[] content', () => {
    const session = new ManagedSession(baseConfig)
    const blocks = [textBlock('hello')]
    session.addMessage('user', blocks)

    const info = session.getInfo()
    expect(info.messages).toHaveLength(1)
    expect(info.messages[0].role).toBe('user')
    expect(info.messages[0].content).toEqual(blocks)
  })

  it('addMessage appends multiple messages', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('user', [textBlock('hello')])
    session.addMessage('assistant', [textBlock('hi there')])

    const info = session.getInfo()
    expect(info.messages).toHaveLength(2)
    expect(info.messages[0].role).toBe('user')
    expect(info.messages[1].role).toBe('assistant')
  })

  it('transition() updates state correctly', () => {
    const session = new ManagedSession(baseConfig)
    expect(session.getState()).toBe('creating')

    session.transition({ type: 'engine_initialized' })
    expect(session.getState()).toBe('streaming')

    session.transition({ type: 'awaiting_input' })
    expect(session.getState()).toBe('awaiting_input')
  })

  it('transition(turn_error) transitions to error state with message', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'turn_error', message: 'API key expired' })

    expect(session.getState()).toBe('error')
    expect(session.snapshot().error).toBe('API key expired')
  })

  it('transition(turn_error) clears activity', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.setActivity('Task: doing stuff')
    expect(session.snapshot().activity).toBe('Task: doing stuff')

    session.transition({ type: 'turn_error', message: 'fail' })
    expect(session.snapshot().activity).toBeNull()
  })

  it('transition(question_asked) enters awaiting_question and clears activity', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.setActivity('Task: processing')

    session.transition({ type: 'question_asked' })
    expect(session.getState()).toBe('awaiting_question')
    expect(session.snapshot().activity).toBeNull()
  })

  it('transition(question_answered) returns to streaming', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'question_asked' })
    expect(session.getState()).toBe('awaiting_question')

    session.transition({ type: 'question_answered' })
    expect(session.getState()).toBe('streaming')
  })

  it('question_asked → question_answered round trip preserves messages', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.transition({ type: 'question_asked' })

    // Simulate user answer recorded by orchestrator.sendMessage
    session.addMessage('user', [textBlock('yes, proceed')])

    session.transition({ type: 'question_answered' })
    expect(session.getState()).toBe('streaming')

    const info = session.getInfo()
    expect(info.messages).toHaveLength(1)
    expect(info.messages[0].role).toBe('user')
  })

  it('transition with unhandled event type throws', () => {
    const session = new ManagedSession(baseConfig)
    // Force a bogus event past TypeScript to verify the runtime safety net
    expect(() => {
      session.transition({ type: 'nonexistent_event' } as never)
    }).toThrow('Unhandled transition event: nonexistent_event')
  })

  it('consecutive question rounds maintain correct state', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })

    // Round 1
    session.transition({ type: 'question_asked' })
    expect(session.getState()).toBe('awaiting_question')
    session.addMessage('user', [textBlock('answer 1')])
    session.transition({ type: 'question_answered' })
    expect(session.getState()).toBe('streaming')

    // Round 2
    session.transition({ type: 'question_asked' })
    expect(session.getState()).toBe('awaiting_question')
    session.addMessage('user', [textBlock('answer 2')])
    session.transition({ type: 'question_answered' })
    expect(session.getState()).toBe('streaming')

    expect(session.getInfo().messages).toHaveLength(2)
  })

  it('transition(protocol_violation) sets error and stopReason=execution_error', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.transition({ type: 'protocol_violation', message: 'Invalid JSON response' })
    expect(session.getState()).toBe('error')
    expect(session.snapshot().error).toBe('Invalid JSON response')
    expect(session.snapshot().stopReason).toBe('execution_error')
  })

  it('transition(spawn_error_transient) transitions to idle with completed stopReason', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.setActivity('Running task...')
    session.transition({ type: 'spawn_error_transient' })
    expect(session.getState()).toBe('idle')
    expect(session.snapshot().stopReason).toBe('completed')
    expect(session.snapshot().activity).toBeNull()
  })

  it('transition(spawn_error_permanent) transitions to error with message', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.transition({ type: 'spawn_error_permanent', message: 'Max retries exceeded' })
    expect(session.getState()).toBe('error')
    expect(session.snapshot().error).toBe('Max retries exceeded')
  })

  it('transition(push_to_active) clears error and enters streaming', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'turn_error', message: 'API key expired' })
    expect(session.getState()).toBe('error')
    session.transition({ type: 'push_to_active' })
    expect(session.getState()).toBe('streaming')
    expect(session.snapshot().error).toBeNull()
    expect(session.snapshot().stopReason).toBeNull()
  })

  it('transition(shutdown) transitions to stopped with user_stopped reason', () => {
    const session = new ManagedSession(baseConfig)
    session.transition({ type: 'engine_initialized' })
    session.transition({ type: 'shutdown' })
    expect(session.getState()).toBe('stopped')
    expect(session.snapshot().stopReason).toBe('user_stopped')
  })

  it('setCostUsd updates total cost', () => {
    const session = new ManagedSession(baseConfig)
    session.setCostUsd(1.23)
    expect(session.getInfo().totalCostUsd).toBe(1.23)
  })

  it('addTokenUsage accumulates input and output tokens', () => {
    const session = new ManagedSession(baseConfig)
    expect(session.getInfo().inputTokens).toBe(0)
    expect(session.getInfo().outputTokens).toBe(0)

    session.addTokenUsage(100, 50)
    expect(session.getInfo().inputTokens).toBe(100)
    expect(session.getInfo().outputTokens).toBe(50)

    session.addTokenUsage(200, 150)
    expect(session.getInfo().inputTokens).toBe(300)
    expect(session.getInfo().outputTokens).toBe(200)
  })

  it('updateMessageBlocks replaces content blocks by messageId', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('assistant', [textBlock('partial')], true)
    const msgId = session.getInfo().messages[0].id

    const newBlocks: ContentBlock[] = [
      textBlock('final'),
      toolUseBlock('tu-1', 'Bash', { command: 'ls' })
    ]
    session.updateMessageBlocks(msgId, newBlocks, false)

    const msg = session.getInfo().messages[0]
    expect(msg.content).toEqual(newBlocks)
    expect(msg.isStreaming).toBe(false)
  })

  it('setActiveToolUseId updates message field', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('assistant', [toolUseBlock('tu-1', 'Read', {})])
    const msgId = session.getInfo().messages[0].id

    session.setActiveToolUseId(msgId, 'tu-1')
    expect(session.getInfo().messages[0].activeToolUseId).toBe('tu-1')

    session.setActiveToolUseId(msgId, null)
    expect(session.getInfo().messages[0].activeToolUseId).toBeNull()
  })

  it('appendToolProgress accumulates on ToolUseBlock', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('assistant', [
      toolUseBlock('tu-1', 'Bash', { command: 'npm test' })
    ])
    const msgId = session.getInfo().messages[0].id

    session.appendToolProgress(msgId, 'tu-1', 'line 1\n')
    session.appendToolProgress(msgId, 'tu-1', 'line 2\n')

    const block = session.getInfo().messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type === 'tool_use') {
      expect(block.progress).toBe('line 1\nline 2\n')
    }
  })

  it('appendToolProgress ignores unknown toolUseId', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('assistant', [toolUseBlock('tu-1', 'Bash', {})])
    const msgId = session.getInfo().messages[0].id

    session.appendToolProgress(msgId, 'unknown-id', 'data')
    const block = session.getInfo().messages[0].content[0]
    if (block.type === 'tool_use') {
      expect(block.progress).toBeUndefined()
    }
  })

  it('setEngineSessionRef stores engine ref without changing public id', () => {
    const session = new ManagedSession(baseConfig)
    const tempId = session.id
    expect(tempId).toMatch(/^ccb-/)

    session.setEngineSessionRef('c66a28ba-561a-4a30-83ea-cc4f038ac728')

    expect(session.id).toBe(tempId)
    expect(session.getInfo().id).toBe(tempId)
    expect(session.getInfo().engineSessionRef).toBe('c66a28ba-561a-4a30-83ea-cc4f038ac728')
    expect(session.getEngineRef()).toBe('c66a28ba-561a-4a30-83ea-cc4f038ac728')
  })

  it('getEngineRef() returns null before engine init', () => {
    const session = new ManagedSession(baseConfig)
    expect(session.getEngineRef()).toBeNull()
  })

  it('getInfo returns a copy (not a reference to internal messages)', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('user', [textBlock('test')])

    const info1 = session.getInfo()
    session.addMessage('assistant', [textBlock('reply')])
    const info2 = session.getInfo()

    expect(info1.messages).toHaveLength(1)
    expect(info2.messages).toHaveLength(2)
  })

  // === System Events ===

  it('addSystemEvent stores system message with event', () => {
    const session = new ManagedSession(baseConfig)
    const event: TaskStartedEvent = {
      type: 'task_started',
      taskId: 'task-1',
      description: 'Research SDK types'
    }
    const msgId = session.addSystemEvent(event)

    const info = session.getInfo()
    expect(info.messages).toHaveLength(1)
    const msg = info.messages[0]
    expect(msg.role).toBe('system')
    if (msg.role === 'system') {
      expect(msg.event).toEqual(event)
    }
    expect(msgId).toBeTruthy()
  })

  it('updateSystemEvent modifies event by refId', () => {
    const session = new ManagedSession(baseConfig)
    const event: HookStatusEvent = {
      type: 'hook',
      hookId: 'hook-1',
      hookName: 'PreToolUse',
      hookTrigger: 'PreToolUse'
    }
    session.addSystemEvent(event)

    session.updateSystemEvent('hook:hook-1', (evt) => {
      if (evt.type === 'hook') {
        evt.outcome = 'success'
        evt.exitCode = 0
        evt.output = 'OK'
      }
    })

    const msg = session.getInfo().messages[0]
    if (msg.role === 'system' && msg.event.type === 'hook') {
      expect(msg.event.outcome).toBe('success')
      expect(msg.event.exitCode).toBe(0)
      expect(msg.event.output).toBe('OK')
    }
  })

  it('updateSystemEvent is no-op for unknown refId', () => {
    const session = new ManagedSession(baseConfig)
    session.addSystemEvent({
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 127000
    })

    // Should not throw
    session.updateSystemEvent('hook:unknown', () => { /* no-op */ })
    expect(session.getInfo().messages).toHaveLength(1)
  })

  it('addSystemEvent interleaves with regular messages', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('user', [textBlock('hello')])
    session.addSystemEvent({ type: 'task_started', taskId: 't-1', description: 'test' })
    session.addMessage('assistant', [textBlock('reply')])

    const messages = session.getInfo().messages
    expect(messages).toHaveLength(3)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('system')
    expect(messages[2].role).toBe('assistant')
  })

  // === Phase 2: New methods ===

  it('getLastMessage returns the last message as a shallow copy', () => {
    const session = new ManagedSession(baseConfig)
    expect(session.getLastMessage()).toBeNull()

    session.addMessage('user', [textBlock('hello')])
    const last = session.getLastMessage()
    expect(last).not.toBeNull()
    expect(last!.role).toBe('user')
    expect(last!.content).toEqual([textBlock('hello')])

    // Should be a copy, not a reference
    session.addMessage('assistant', [textBlock('reply')])
    expect(last!.role).toBe('user') // original reference unchanged
    expect(session.getLastMessage()!.role).toBe('assistant')
  })

  it('getMessageById returns the matching message', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('user', [textBlock('hello')])
    session.addMessage('assistant', [textBlock('reply')])

    const info = session.getInfo()
    const firstId = info.messages[0].id
    const secondId = info.messages[1].id

    const first = session.getMessageById(firstId)
    expect(first).not.toBeNull()
    expect(first!.role).toBe('user')

    const second = session.getMessageById(secondId)
    expect(second).not.toBeNull()
    expect(second!.role).toBe('assistant')
  })

  it('getMessageById returns null for unknown id', () => {
    const session = new ManagedSession(baseConfig)
    session.addMessage('user', [textBlock('hello')])
    expect(session.getMessageById('nonexistent')).toBeNull()
  })

  it('recordTurnUsage accumulates tokens incrementally', () => {
    const session = new ManagedSession(baseConfig)
    session.recordTurnUsage(100, 50)
    expect(session.getInfo().inputTokens).toBe(100)
    expect(session.getInfo().outputTokens).toBe(50)

    session.recordTurnUsage(200, 150)
    expect(session.getInfo().inputTokens).toBe(300)
    expect(session.getInfo().outputTokens).toBe(200)
  })

  it('setFinalTokenUsage overwrites accumulated values', () => {
    const session = new ManagedSession(baseConfig)
    // Simulate per-turn accumulation
    session.recordTurnUsage(100, 50)
    session.recordTurnUsage(200, 150)
    expect(session.getInfo().inputTokens).toBe(300)
    expect(session.getInfo().outputTokens).toBe(200)

    // Result handler provides final aggregate — overwrites
    session.setFinalTokenUsage(250, 180)
    expect(session.getInfo().inputTokens).toBe(250)
    expect(session.getInfo().outputTokens).toBe(180)
  })

  it('applyContextSnapshot with estimated confidence sets usedTokens', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 123,
      limitTokens: null,
      source: 'claude.assistant_usage',
      confidence: 'estimated',
      updatedAtMs: Date.now(),
    })
    expect(session.getInfo().contextState?.usedTokens).toBe(123)
  })

  it('applyContextSnapshot with null limitTokens preserves existing limit', () => {
    const session = new ManagedSession(baseConfig)
    // First set a known limit from model usage
    session.setContextLimitFromModelUsage(200_000)
    expect(session.getInfo().contextLimitOverride).toBe(200_000)

    // Then apply snapshot with null limitTokens — should preserve 200k
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 50_000,
      limitTokens: null,
      source: 'claude.assistant_usage',
      confidence: 'estimated',
      updatedAtMs: Date.now(),
    })
    const info = session.getInfo()
    expect(info.contextState?.usedTokens).toBe(50_000)
    expect(info.contextState?.limitTokens).toBe(200_000)
  })

  it('setContextLimitFromModelUsage stores dynamic context window override', () => {
    const session = new ManagedSession(baseConfig)
    session.setContextLimitFromModelUsage(1_000_000)
    expect(session.getInfo().contextLimitOverride).toBe(1_000_000)

    session.setContextLimitFromModelUsage(null)
    expect(session.getInfo().contextLimitOverride).toBeNull()
  })

  it('applyContextSnapshot stores authoritative telemetry and syncs compatibility fields', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 1024,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 1_710_000_000_000,
    })

    const info = session.getInfo()
    expect(info.contextState?.usedTokens).toBe(1024)
    expect(info.contextState?.limitTokens).toBe(272000)
    expect(info.contextTelemetry?.usedTokens).toBe(1024)
    expect(info.contextTelemetry?.limitTokens).toBe(272000)
    expect(info.contextTelemetry?.remainingTokens).toBe(270976)
    expect(info.contextTelemetry?.confidence).toBe('authoritative')
    expect(info.contextLimitOverride).toBe(272000)
  })

  it('does not downgrade authoritative context state with estimated snapshots', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 4096,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 2_000,
    })

    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 12,
      limitTokens: null,
      source: 'codex.turn_usage',
      confidence: 'estimated',
      updatedAtMs: 2_100,
    })
    const info = session.getInfo()
    expect(info.contextState?.usedTokens).toBe(4096)
    expect(info.contextState?.confidence).toBe('authoritative')
    expect(info.contextState?.source).toBe('codex.token_count')
  })

  it('ignores stale authoritative context snapshots and keeps latest', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 5000,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 3_000,
    })

    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 4500,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 2_500,
    })

    const info = session.getInfo()
    expect(info.contextState?.usedTokens).toBe(5000)
    expect(info.contextState?.updatedAtMs).toBe(3000)
  })

  it('clearContextState resets context tracking', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 90000,
      limitTokens: 200000,
      source: 'claude.assistant_usage',
      confidence: 'estimated',
      updatedAtMs: Date.now(),
    })
    expect(session.getInfo().contextState).not.toBeNull()

    session.clearContextState()
    expect(session.getInfo().contextState).toBeNull()
    expect(session.getInfo().lastInputTokens).toBe(0)
  })

  it('setModel clears stale contextLimitOverride', () => {
    const session = new ManagedSession(baseConfig)
    session.setContextLimitFromModelUsage(200_000)
    expect(session.getInfo().contextLimitOverride).toBe(200_000)

    session.setModel('claude-opus-4-6')
    expect(session.getInfo().contextLimitOverride).toBeNull()
  })

  it('setModel downgrades contextState to estimated and clears model-scoped limit', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 2048,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 1_710_000_000_123,
    })
    expect(session.getInfo().contextTelemetry).not.toBeNull()

    session.setModel('gpt-5-codex')
    const info = session.getInfo()
    // Model-scoped limit is cleared; usedTokens preserved as estimated
    expect(info.contextState).not.toBeNull()
    expect(info.contextState!.usedTokens).toBe(2048)
    expect(info.contextState!.limitTokens).toBeNull()
    expect(info.contextState!.confidence).toBe('estimated')
    expect(info.contextState!.metricKind).toBe('context_occupancy')
    // contextTelemetry requires non-null limitTokens to compute remaining%
    expect(info.contextTelemetry).toBeNull()
  })

  it('setModel fully clears contextState when usedTokens is 0', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'context_occupancy', usedTokens: 0,
      limitTokens: null,
      source: 'test',
      confidence: 'estimated',
      updatedAtMs: Date.now(),
    })
    session.setModel('claude-opus-4-6')
    const info = session.getInfo()
    expect(info.contextState).toBeNull()
    expect(info.lastInputTokens).toBe(0)
  })

  it('normalizes unsupported metricKind to context_occupancy', () => {
    const session = new ManagedSession(baseConfig)
    session.applyContextSnapshot({
      metricKind: 'token_usage_total' as any,
      usedTokens: 2048,
      limitTokens: 200_000,
      source: 'test',
      confidence: 'estimated',
      updatedAtMs: Date.now(),
    })
    expect(session.getInfo().contextState?.metricKind).toBe('context_occupancy')
  })

  it('fromInfo restores runtime model but does not restore startup model override', () => {
    const now = Date.now()
    const restored = ManagedSession.fromInfo({
      id: 'ccb-restored',
      engineSessionRef: 'engine-ref',
      engineState: null,
      state: 'idle',
      stopReason: 'completed',
      origin: { source: 'agent' },
      projectPath: '/tmp/project',
      projectId: 'project-1',
      model: 'claude-sonnet-4-6',
      messages: [],
      createdAt: now - 1000,
      lastActivity: now,
      activeDurationMs: 0,
      activeStartedAt: null,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastInputTokens: 0,
      contextLimitOverride: null,
      contextState: null,
      contextTelemetry: null,
      activity: null,
      error: null,
      executionContext: null,
    })

    expect(restored.getModel()).toBe('claude-sonnet-4-6')
    expect(restored.getModelOverride()).toBeNull()
    expect(restored.getConfig().model).toBeUndefined()
  })
})
