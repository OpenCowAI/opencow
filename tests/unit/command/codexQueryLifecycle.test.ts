// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import {
  CodexQueryLifecycle,
  sanitizeCodexMcpConfig,
  __resetCodexSdkLoaderForTest,
  __setCodexSdkLoaderForTest,
} from '../../../electron/command/codexQueryLifecycle'
import type { EngineRuntimeEventEnvelope } from '../../../electron/conversation/runtime/events'
import type { UserMessageContent } from '../../../src/shared/types'
import { NativeCapabilityTools } from '../../../src/shared/nativeCapabilityToolNames'

type MockCodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | {
      type: 'item.started' | 'item.updated' | 'item.completed'
      item: { type: string; id?: string; [key: string]: unknown }
    }
  | { type: 'turn.started' }
  | {
      type: 'event_msg'
      payload: Record<string, unknown>
    }
  | { type: 'turn.completed'; usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number } }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'error'; message: string }

interface MockTurnPlan {
  events?: MockCodexEvent[]
  waitForAbort?: boolean
}

const codexMocks = vi.hoisted(() => {
  const state = {
    turnPlans: [] as MockTurnPlan[],
    runInputs: [] as unknown[],
  }

  const mockThreadRunStreamed = vi.fn(async (input: unknown, options?: { signal?: AbortSignal }) => {
    state.runInputs.push(input)
    const plan = state.turnPlans.shift() ?? {
      events: [{ type: 'turn.completed', usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 } }],
    }

    const events = (async function* () {
      if (plan.waitForAbort) {
        const abortError = Object.assign(new Error('Aborted'), { name: 'AbortError' })
        if (options?.signal?.aborted) throw abortError
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(abortError), { once: true })
        })
        return
      }
      for (const event of plan.events ?? []) {
        yield event
      }
    })()

    return { events }
  })

  const mockThread = {
    runStreamed: mockThreadRunStreamed,
  }

  const mockStartThread = vi.fn(() => mockThread)
  const mockResumeThread = vi.fn(() => mockThread)
  const mockCodexCtor = vi.fn(function MockCodex() {
    return {
      startThread: mockStartThread,
      resumeThread: mockResumeThread,
    }
  })

  return {
    state,
    mockThreadRunStreamed,
    mockStartThread,
    mockResumeThread,
    mockCodexCtor,
  }
})

async function collectUntilResult(
  iter: AsyncIterator<EngineRuntimeEventEnvelope>,
): Promise<EngineRuntimeEventEnvelope[]> {
  const emitted: EngineRuntimeEventEnvelope[] = []
  for (let i = 0; i < 48; i++) {
    const next = await iter.next()
    if (next.done || !next.value) break
    emitted.push(next.value)
    if (next.value.event.kind === 'turn.result') break
  }
  return emitted
}

describe('CodexQueryLifecycle', () => {
  beforeEach(() => {
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    codexMocks.state.turnPlans = []
    codexMocks.state.runInputs.length = 0
    codexMocks.mockThreadRunStreamed.mockClear()
    codexMocks.mockStartThread.mockClear()
    codexMocks.mockResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(() => {
    __resetCodexSdkLoaderForTest()
  })

  it('emits normalized runtime events for a successful turn', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.started' },
        {
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: { input_tokens: 1234 },
              model_context_window: 272000,
            },
          },
        },
        { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'hello' } },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'hello world' } },
        { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('hi', { model: 'gpt-5-codex' })
    const iter = stream[Symbol.asyncIterator]()

    const emitted = await collectUntilResult(iter)

    expect(emitted.some((item) => item.event.kind === 'session.initialized')).toBe(true)
    const initialized = emitted.find((item) => item.event.kind === 'session.initialized')
    expect(initialized?.event.kind).toBe('session.initialized')
    if (initialized?.event.kind === 'session.initialized') {
      expect(initialized.event.payload.model).toBe('gpt-5-codex')
    }
    expect(emitted.some((item) => item.event.kind === 'turn.started')).toBe(true)
    expect(emitted.some((item) => item.event.kind === 'assistant.partial')).toBe(true)
    expect(emitted.some((item) => item.event.kind === 'assistant.final')).toBe(true)
    expect(emitted.some((item) => item.event.kind === 'turn.usage')).toBe(true)
    const contextSnapshot = emitted.find((item) => item.event.kind === 'context.snapshot')
    expect(contextSnapshot).toBeTruthy()
    expect(contextSnapshot?.turnRef).toBeUndefined()
    if (contextSnapshot?.event.kind === 'context.snapshot') {
      expect(contextSnapshot.event.payload.usedTokens).toBe(1234)
      expect(contextSnapshot.event.payload.limitTokens).toBe(272000)
      expect(contextSnapshot.event.payload.source).toBe('codex.token_count')
      expect(contextSnapshot.event.payload.confidence).toBe('authoritative')
    }

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    expect(result?.event.kind).toBe('turn.result')
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
      expect(result.event.payload.modelUsage?.codex.inputTokens).toBe(10)
      expect(result.event.payload.modelUsage?.codex.outputTokens).toBe(3)
    }

    await lifecycle.stop()
  })

  it('supports pushMessage() for multi-turn conversations', async () => {
    codexMocks.state.turnPlans.push(
      {
        events: [
          { type: 'thread.started', thread_id: 'thread-multi' },
          { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'first' } },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
        ],
      },
      {
        events: [
          { type: 'item.completed', item: { id: 'm2', type: 'agent_message', text: 'second' } },
          { type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 2 } },
        ],
      },
    )

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('turn-1', {})
    const iter = stream[Symbol.asyncIterator]()

    const firstTurn = await collectUntilResult(iter)
    expect(firstTurn.some((item) => item.event.kind === 'turn.result')).toBe(true)

    lifecycle.pushMessage('turn-2')
    const secondTurn = await collectUntilResult(iter)
    const secondResult = secondTurn.find((item) => item.event.kind === 'turn.result')
    expect(secondResult).toBeTruthy()
    if (secondResult?.event.kind === 'turn.result') {
      expect(secondResult.event.payload.outcome).toBe('success')
      expect(secondResult.event.payload.modelUsage?.codex.inputTokens).toBe(2)
      expect(secondResult.event.payload.modelUsage?.codex.outputTokens).toBe(2)
    }

    await lifecycle.stop()
  })

  it('materializes image blocks to local_image entries and cleans temp files', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-images' },
        { type: 'turn.started' },
        { type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1 } },
      ],
    })

    const messageWithImage: UserMessageContent = [
      { type: 'text', text: 'Please review this screenshot' },
      { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', sizeBytes: 5 },
    ]

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start(messageWithImage, {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    expect(codexMocks.state.runInputs).toHaveLength(1)
    const runInput = codexMocks.state.runInputs[0]
    expect(Array.isArray(runInput)).toBe(true)

    const imagePaths: string[] = []
    if (Array.isArray(runInput)) {
      expect(runInput.some((item) => item?.type === 'text')).toBe(true)
      const localImages = runInput.filter((item) => item?.type === 'local_image')
      expect(localImages).toHaveLength(1)
      for (const item of localImages) {
        if (typeof item?.path === 'string') imagePaths.push(item.path)
      }
      expect(imagePaths[0]?.endsWith('.png')).toBe(true)
    }

    await lifecycle.stop()

    for (const imagePath of imagePaths) {
      expect(existsSync(imagePath)).toBe(false)
    }
  })

  it('injects explicit evose execution hint for slash_command providerExecution', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-evose-explicit' },
        { type: 'turn.started' },
        { type: 'turn.completed', usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1 } },
      ],
    })

    const message: UserMessageContent = [
      { type: 'text', text: 'Analyze AI Agent trends from the past week' },
      {
        type: 'slash_command',
        name: 'evose:x_analyst_ja4t9n',
        category: 'skill',
        label: 'X Analyst',
        execution: {
          nativeRequirements: [{ capability: 'evose' }],
          providerExecution: {
            provider: 'evose',
            appId: '92226822732779520',
            appType: 'agent',
            gatewayTool: 'evose_run_agent',
          },
        },
        expandedText: 'Use this capability to run Evose Agent "X Analyst".',
      },
    ]

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start(message, {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    expect(codexMocks.state.runInputs).toHaveLength(1)
    const runInput = codexMocks.state.runInputs[0]
    expect(typeof runInput).toBe('string')
    if (typeof runInput === 'string') {
      expect(runInput).toContain('<command-message>evose:x_analyst_ja4t9n</command-message>')
      expect(runInput).toContain(`<gateway-tool>${NativeCapabilityTools.EVOSE_RUN_AGENT}</gateway-tool>`)
      expect(runInput).toContain('<app-id>92226822732779520</app-id>')
      expect(runInput).toContain('MANDATORY: User explicitly selected this Evose app.')
    }

    await lifecycle.stop()
  })

  it('keeps explicit evose execution hint when prompt is sent as mixed content entries', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-evose-mixed-input' },
        { type: 'turn.started' },
        { type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 1 } },
      ],
    })

    const message: UserMessageContent = [
      { type: 'text', text: 'Please call the Evose app I selected' },
      {
        type: 'slash_command',
        name: 'evose:agent_github_iab8p2',
        category: 'skill',
        label: 'Agent - Github',
        execution: {
          nativeRequirements: [{ capability: 'evose' }],
          providerExecution: {
            provider: 'evose',
            appId: '93219761231499264',
            appType: 'agent',
            gatewayTool: 'evose_run_agent',
          },
        },
        expandedText: 'Use this capability to run Evose Agent "Agent - Github".',
      },
      { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=', sizeBytes: 5 },
    ]

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start(message, {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    expect(codexMocks.state.runInputs).toHaveLength(1)
    const runInput = codexMocks.state.runInputs[0]
    expect(Array.isArray(runInput)).toBe(true)
    if (Array.isArray(runInput)) {
      const textEntries = runInput.filter(
        (entry): entry is { type: 'text'; text: string } =>
          !!entry && typeof entry === 'object' && entry.type === 'text' && typeof entry.text === 'string',
      )
      const mergedText = textEntries.map((entry) => entry.text).join('\n')
      expect(mergedText).toContain('<command-message>evose:agent_github_iab8p2</command-message>')
      expect(mergedText).toContain(`<gateway-tool>${NativeCapabilityTools.EVOSE_RUN_AGENT}</gateway-tool>`)
      expect(mergedText).toContain('<app-id>93219761231499264</app-id>')
      expect(mergedText).toContain('MANDATORY: User explicitly selected this Evose app.')
      expect(runInput.some((entry) => !!entry && typeof entry === 'object' && entry.type === 'local_image')).toBe(true)
    }

    await lifecycle.stop()
  })

  it('maps turn failure to execution_error result', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-fail' },
        { type: 'turn.failed', error: { message: 'boom' } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('fail', {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('execution_error')
      expect(result.event.payload.errors).toEqual(['boom'])
    }

    await lifecycle.stop()
  })

  it('keeps turn active when codex emits non-fatal warning diagnostics', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-warn' },
        { type: 'turn.started' },
        {
          type: 'error',
          message: 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.',
        },
        { type: 'item.updated', item: { id: 'm1', type: 'agent_message', text: 'still working' } },
        { type: 'turn.completed', usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 2 } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('warn-turn', {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const diagnostic = emitted.find((item) => item.event.kind === 'engine.diagnostic')
    expect(diagnostic).toBeTruthy()
    if (diagnostic?.event.kind === 'engine.diagnostic') {
      expect(diagnostic.event.payload.code).toBe('codex.long_thread_compaction_advisory')
      expect(diagnostic.event.payload.terminal).toBe(false)
    }

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    await lifecycle.stop()
  })

  it('emits initialized event immediately when resume id is provided', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'resumed' } },
        { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('resume-turn', { resume: 'resume-thread-id' })
    const iter = stream[Symbol.asyncIterator]()

    const first = await iter.next()
    expect(first.done).toBe(false)
    expect(first.value?.event.kind).toBe('session.initialized')
    if (first.value?.event.kind === 'session.initialized') {
      expect(first.value.event.payload.sessionRef).toBe('resume-thread-id')
    }

    await lifecycle.stop()
  })

  it('emits non-terminal diagnostic when token_count payload is malformed', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-bad-token-count' },
        { type: 'turn.started' },
        {
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: { input_tokens: 123 },
              // model_context_window intentionally missing
            },
          },
        },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'done' } },
        { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('malformed-token-count', {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const diagnostic = emitted.find((item) => item.event.kind === 'engine.diagnostic')
    expect(diagnostic).toBeTruthy()
    if (diagnostic?.event.kind === 'engine.diagnostic') {
      expect(diagnostic.event.payload.code).toBe('codex.token_count_unparseable')
      expect(diagnostic.event.payload.terminal).toBe(false)
    }

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    await lifecycle.stop()
  })

  it('keeps turn active across reconnecting retries and succeeds after recovery', async () => {
    codexMocks.state.turnPlans.push({
      events: [
        { type: 'thread.started', thread_id: 'thread-retry' },
        { type: 'turn.started' },
        { type: 'error', message: 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable)' },
        { type: 'error', message: 'Reconnecting... 2/5 (unexpected status 503 Service Unavailable)' },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'recovered' } },
        { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2 } },
      ],
    })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('retry-prompt', {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    // Reconnecting errors should be non-terminal diagnostics, not killing the turn
    const diagnostics = emitted.filter((item) => item.event.kind === 'engine.diagnostic')
    expect(diagnostics.length).toBeGreaterThanOrEqual(2)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('success')
    }

    await lifecycle.stop()
  })

  it('surfaces last error event message when binary exits with non-zero code', async () => {
    // Simulate: binary emits error events then generator throws (exit code 1)
    const throwAfterErrors = vi.fn(async (_input: unknown) => {
      const events = (async function* () {
        yield { type: 'thread.started', thread_id: 'thread-err' }
        yield { type: 'turn.started' }
        yield { type: 'error', message: 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable)' }
        yield { type: 'error', message: 'Reconnecting... 5/5 (unexpected status 503 Service Unavailable: url: http://example.com)' }
        // Binary exits with code 1 after retries exhausted
        throw new Error('Codex Exec exited with code 1: Reading prompt from stdin...')
      })()
      return { events }
    })

    codexMocks.mockThreadRunStreamed.mockImplementationOnce(throwAfterErrors)

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('failing-prompt', {})
    const iter = stream[Symbol.asyncIterator]()
    const emitted = await collectUntilResult(iter)

    const result = emitted.find((item) => item.event.kind === 'turn.result')
    expect(result).toBeTruthy()
    if (result?.event.kind === 'turn.result') {
      expect(result.event.payload.outcome).toBe('execution_error')
      // Should surface the last error event message, NOT the generic stderr
      expect(result.event.payload.errors?.[0]).toContain('Reconnecting... 5/5')
      expect(result.event.payload.errors?.[0]).not.toContain('Reading prompt from stdin')
    }

    await lifecycle.stop()
  })

  it('stop() aborts a waiting turn without throwing', async () => {
    codexMocks.state.turnPlans.push({ waitForAbort: true })

    const lifecycle = new CodexQueryLifecycle()
    const stream = lifecycle.start('waiting', {})

    const consuming = (async () => {
      for await (const _event of stream) {
        // consume until stop
      }
    })()

    await lifecycle.stop()
    await consuming
    expect(lifecycle.stopped).toBe(true)
  })
})

describe('sanitizeCodexMcpConfig', () => {
  it('returns config unchanged when no mcp_servers are present', () => {
    const config = { model_provider: 'test', model_providers: {} }
    const result = sanitizeCodexMcpConfig(config)
    expect(result).toEqual(config)
  })

  it('returns config unchanged when mcp_servers have valid commands', () => {
    // process.execPath always exists
    const config = {
      model_provider: 'test',
      mcp_servers: {
        valid: {
          command: process.execPath,
          args: [],
        },
      },
    }
    const result = sanitizeCodexMcpConfig(config)
    expect(result).toEqual(config)
  })

  it('removes MCP servers whose command does not exist on disk', () => {
    const config = {
      model_provider: 'test',
      mcp_servers: {
        missing: {
          command: '/nonexistent/path/to/node-that-does-not-exist',
          args: ['/tmp/script.js'],
        },
      },
    }
    const result = sanitizeCodexMcpConfig(config)
    // mcp_servers key should be removed entirely since only server was invalid
    expect(result.mcp_servers).toBeUndefined()
    expect(result.model_provider).toBe('test')
  })

  it('removes MCP servers whose script arg does not exist on disk', () => {
    const config = {
      mcp_servers: {
        bridged: {
          command: process.execPath,
          args: ['/nonexistent/opencow-codex-bridge/stdio-bridge-that-does-not-exist.cjs'],
          env: {
            BRIDGE_URL: 'http://127.0.0.1:9999',
          },
        },
      },
    }
    const result = sanitizeCodexMcpConfig(config)
    expect(result.mcp_servers).toBeUndefined()
  })

  it('keeps valid servers and removes only invalid ones', () => {
    const config = {
      mcp_servers: {
        valid: {
          command: process.execPath,
          args: [],
        },
        invalid: {
          command: '/nonexistent/binary',
          args: [],
        },
      },
    }
    const result = sanitizeCodexMcpConfig(config)
    const servers = result.mcp_servers as Record<string, unknown>
    expect(servers).toBeTruthy()
    expect(servers.valid).toBeTruthy()
    expect(servers.invalid).toBeUndefined()
  })

  it('preserves non-mcp_servers config keys when stripping invalid servers', () => {
    const config = {
      model_provider: 'opencow-managed',
      model_providers: {
        'opencow-managed': {
          name: 'OpenCow Managed',
          base_url: 'https://api.example.com/v1',
        },
      },
      mcp_servers: {
        broken: {
          command: '/no/such/binary',
          args: [],
        },
      },
    }
    const result = sanitizeCodexMcpConfig(config)
    expect(result.model_provider).toBe('opencow-managed')
    expect(result.model_providers).toEqual({
      'opencow-managed': {
        name: 'OpenCow Managed',
        base_url: 'https://api.example.com/v1',
      },
    })
    expect(result.mcp_servers).toBeUndefined()
  })
})
