// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CodexRuntimeEventAdapter } from '../../../electron/conversation/runtime/codexRuntimeAdapter'

describe('CodexRuntimeEventAdapter', () => {
  it('maps thread.started into session.initialized', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'thread.started',
      thread_id: 'thread-1',
    } as never)

    expect(result.hasTerminalResult).toBe(false)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('session.initialized')
    if (result.events[0]?.kind === 'session.initialized') {
      expect(result.events[0].payload.sessionRef).toBe('thread-1')
    }
  })

  it('emits turn.started when codex turn begins', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({ type: 'turn.started' } as never)

    expect(result.hasTerminalResult).toBe(false)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('turn.started')
  })

  it('maps turn.failed into terminal execution_error result', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'turn.failed',
      error: { message: 'boom' },
    } as never)

    expect(result.hasTerminalResult).toBe(true)
    const turnResult = result.events.find((event) => event.kind === 'turn.result')
    expect(turnResult?.kind).toBe('turn.result')
    if (turnResult?.kind === 'turn.result') {
      expect(turnResult.payload.outcome).toBe('execution_error')
      expect(turnResult.payload.errors).toEqual(['boom'])
    }
  })

  it('emits non-terminal engine diagnostic for codex lag warning event', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'error',
      message: 'in-process app-server event stream lagged; dropped 35 events',
    } as never)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('engine.diagnostic')
    if (result.events[0]?.kind === 'engine.diagnostic') {
      expect(result.events[0].payload.code).toBe('codex.event_stream_lag')
      expect(result.events[0].payload.terminal).toBe(false)
      expect(result.events[0].payload.severity).toBe('warning')
    }
    expect(result.hasTerminalResult).toBe(false)
  })

  it('emits non-terminal engine diagnostic for codex long-thread advisory event', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'error',
      message: 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
    } as never)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('engine.diagnostic')
    if (result.events[0]?.kind === 'engine.diagnostic') {
      expect(result.events[0].payload.code).toBe('codex.long_thread_compaction_advisory')
      expect(result.events[0].payload.terminal).toBe(false)
      expect(result.events[0].payload.severity).toBe('warning')
    }
    expect(result.hasTerminalResult).toBe(false)
  })

  it('emits non-terminal engine diagnostic for completed item advisory error', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const advisory = adapter.adapt({
      type: 'item.completed',
      item: {
        id: 'err-compaction-1',
        type: 'error',
        message: 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
      },
    } as never)

    expect(advisory.events).toHaveLength(1)
    expect(advisory.events[0]?.kind).toBe('engine.diagnostic')
    expect(advisory.hasTerminalResult).toBe(false)

    const completed = adapter.adapt({
      type: 'turn.completed',
      usage: {
        input_tokens: 1,
        cached_input_tokens: 0,
        output_tokens: 1,
      },
    } as never)

    const turnResult = completed.events.find((event) => event.kind === 'turn.result')
    expect(turnResult?.kind).toBe('turn.result')
    if (turnResult?.kind === 'turn.result') {
      expect(turnResult.payload.outcome).toBe('success')
    }
    expect(completed.hasTerminalResult).toBe(true)
  })

  it('emits non-terminal diagnostic for reconnecting retry errors', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'error',
      message: 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable: Service temporarily unavailable, url: http://example.com/responses, request id: abc-123)',
    } as never)

    expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('engine.diagnostic')
    if (result.events[0]?.kind === 'engine.diagnostic') {
      expect(result.events[0].payload.code).toBe('codex.reconnecting')
      expect(result.events[0].payload.terminal).toBe(false)
      expect(result.events[0].payload.severity).toBe('warning')
    }
    expect(result.hasTerminalResult).toBe(false)
  })

  it('allows turn to succeed after transient reconnecting errors', () => {
    const adapter = new CodexRuntimeEventAdapter()

    // Simulate reconnecting retries — all should be non-terminal
    for (let i = 1; i <= 3; i++) {
      const retryResult = adapter.adapt({
        type: 'error',
        message: `Reconnecting... ${i}/5 (unexpected status 503)`,
      } as never)
      expect(retryResult.hasTerminalResult).toBe(false)
    }

    // Eventually the turn completes successfully
    const completed = adapter.adapt({
      type: 'turn.completed',
      usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
    } as never)
    const turnResult = completed.events.find((event) => event.kind === 'turn.result')
    expect(turnResult?.kind).toBe('turn.result')
    if (turnResult?.kind === 'turn.result') {
      expect(turnResult.payload.outcome).toBe('success')
    }
    expect(completed.hasTerminalResult).toBe(true)
  })

  it('maps unknown codex error events to terminal execution_error result', () => {
    const adapter = new CodexRuntimeEventAdapter()
    const result = adapter.adapt({
      type: 'error',
      message: 'fatal transport error',
    } as never)

    const turnResult = result.events.find((event) => event.kind === 'turn.result')
    expect(turnResult?.kind).toBe('turn.result')
    if (turnResult?.kind === 'turn.result') {
      expect(turnResult.payload.outcome).toBe('execution_error')
      expect(turnResult.payload.errors).toEqual(['fatal transport error'])
    }
    expect(result.hasTerminalResult).toBe(true)
  })

  it('stops emitting assistant events after terminal turn result', () => {
    const adapter = new CodexRuntimeEventAdapter()

    const partial = adapter.adapt({
      type: 'item.updated',
      item: {
        type: 'agent_message',
        id: 'm-1',
        text: 'partial text',
      },
    } as never)
    expect(partial.events.some((event) => event.kind === 'assistant.partial')).toBe(true)

    const terminal = adapter.adapt({
      type: 'turn.completed',
      usage: {
        input_tokens: 5,
        cached_input_tokens: 2,
        output_tokens: 3,
      },
    } as never)

    expect(terminal.events.some((event) => event.kind === 'assistant.final')).toBe(true)
    expect(terminal.events.some((event) => event.kind === 'turn.result')).toBe(true)
    expect(terminal.hasTerminalResult).toBe(true)

    const lateEvent = adapter.adapt({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        id: 'm-late',
        text: 'late text',
      },
    } as never)
    expect(lateEvent.events).toEqual([])
    expect(lateEvent.hasTerminalResult).toBe(true)
  })

  it('emits independent turn.usage event on turn completion', () => {
    const adapter = new CodexRuntimeEventAdapter()

    adapter.adapt({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        id: 'm-usage',
        text: 'done',
      },
    } as never)

    const completed = adapter.adapt({
      type: 'turn.completed',
      usage: {
        input_tokens: 120,
        cached_input_tokens: 30,
        output_tokens: 20,
      },
    } as never)

    const usageEvent = completed.events.find((event) => event.kind === 'turn.usage')
    expect(usageEvent?.kind).toBe('turn.usage')
    if (usageEvent?.kind === 'turn.usage') {
      expect(usageEvent.payload).toEqual({
        inputTokens: 120,
        outputTokens: 20,
        cacheReadInputTokens: 30,
        cacheCreationInputTokens: 0,
      })
    }

    const turnResult = completed.events.find((event) => event.kind === 'turn.result')
    expect(turnResult?.kind).toBe('turn.result')
    if (turnResult?.kind === 'turn.result') {
      expect(turnResult.payload.modelUsage?.codex.inputTokens).toBe(120)
      expect(turnResult.payload.modelUsage?.codex.outputTokens).toBe(20)
    }
  })

  it('emits execution_context.signal when a completed bash command reports cwd via pwd', () => {
    const adapter = new CodexRuntimeEventAdapter()

    const result = adapter.adapt({
      type: 'item.completed',
      item: {
        id: 'cmd-cwd-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'cd .worktrees/feat-issue-schedule-session-reuse && pwd'",
        aggregated_output: '/Users/hikoqiu/workspace/ai-agent-workspace/OpenCow/.worktrees/feat-issue-schedule-session-reuse\n',
        exit_code: 0,
        status: 'completed',
      },
    } as never)

    const signal = result.events.find((event) => event.kind === 'execution_context.signal')
    expect(signal?.kind).toBe('execution_context.signal')
    if (signal?.kind === 'execution_context.signal') {
      expect(signal.payload.cwd).toBe('/Users/hikoqiu/workspace/ai-agent-workspace/OpenCow/.worktrees/feat-issue-schedule-session-reuse')
      expect(signal.payload.source).toBe('runtime.tool')
      expect(signal.payload.toolUseId).toBe('cmd-cwd-1')
      expect(signal.payload.toolName).toBe('Bash')
    }
  })

  it('emits execution_context.signal for unquoted shell wrapper commands (e.g. /bin/zsh -lc pwd)', () => {
    const adapter = new CodexRuntimeEventAdapter()

    const result = adapter.adapt({
      type: 'item.completed',
      item: {
        id: 'cmd-cwd-unquoted-1',
        type: 'command_execution',
        command: '/bin/zsh -lc pwd',
        aggregated_output: '/Users/hikoqiu/workspace/ai-agent-workspace/OpenCow/.worktrees/feat-issue-schedule-session-reuse\n',
        exit_code: 0,
        status: 'completed',
      },
    } as never)

    const signal = result.events.find((event) => event.kind === 'execution_context.signal')
    expect(signal?.kind).toBe('execution_context.signal')
    if (signal?.kind === 'execution_context.signal') {
      expect(signal.payload.cwd).toBe('/Users/hikoqiu/workspace/ai-agent-workspace/OpenCow/.worktrees/feat-issue-schedule-session-reuse')
      expect(signal.payload.source).toBe('runtime.tool')
      expect(signal.payload.toolUseId).toBe('cmd-cwd-unquoted-1')
      expect(signal.payload.toolName).toBe('Bash')
    }
  })

  it('does not emit execution_context.signal for commands without pwd token', () => {
    const adapter = new CodexRuntimeEventAdapter()

    const result = adapter.adapt({
      type: 'item.completed',
      item: {
        id: 'cmd-no-pwd-1',
        type: 'command_execution',
        command: "/bin/zsh -lc 'cd .worktrees/feat-issue-schedule-session-reuse && ls -la'",
        aggregated_output: '/Users/hikoqiu/workspace/ai-agent-workspace/OpenCow/.worktrees/feat-issue-schedule-session-reuse\n',
        exit_code: 0,
        status: 'completed',
      },
    } as never)

    expect(result.events.some((event) => event.kind === 'execution_context.signal')).toBe(false)
  })
})
