// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryLifecycle, __setOpenClaudeModuleLoaderForTest } from '../../../electron/command/queryLifecycle'
import { createProviderNativeSystemPrompt } from '../../../electron/command/systemPromptTransport'

// Mock SDK query — returns an async generator that we can control
const mockClose = vi.fn()
let yieldQueue: Array<{ resolve: (v: IteratorResult<unknown>) => void }> = []
let generatorDone = false

function createMockQuery() {
  yieldQueue = []
  generatorDone = false
  mockClose.mockReset()

  const generator = {
    next: () =>
      new Promise<IteratorResult<unknown>>((resolve) => {
        if (generatorDone) {
          resolve({ value: undefined, done: true })
        } else {
          yieldQueue.push({ resolve })
        }
      }),
    return: () => {
      generatorDone = true
      for (const pending of yieldQueue) {
        pending.resolve({ value: undefined, done: true })
      }
      yieldQueue = []
      return Promise.resolve({ value: undefined, done: true as const })
    },
    throw: (err: unknown) => Promise.reject(err),
    [Symbol.asyncIterator]: () => generator,
    close: () => {
      mockClose()
      generatorDone = true
      for (const pending of yieldQueue) {
        pending.resolve({ value: undefined, done: true })
      }
      yieldQueue = []
    },
    interrupt: () => Promise.resolve(),
    setPermissionMode: () => Promise.resolve(),
    setModel: () => Promise.resolve(),
    setMaxThinkingTokens: () => Promise.resolve(),
    initializationResult: () => Promise.resolve({}),
    supportedCommands: () => Promise.resolve([]),
    supportedModels: () => Promise.resolve([]),
    mcpServerStatus: () => Promise.resolve([]),
    accountInfo: () => Promise.resolve({}),
    rewindFiles: () => Promise.resolve({ canRewind: false }),
    reconnectMcpServer: () => Promise.resolve(),
    toggleMcpServer: () => Promise.resolve(),
    setMcpServers: () => Promise.resolve({}),
    streamInput: () => Promise.resolve(),
    stopTask: () => Promise.resolve()
  }

  return generator
}

vi.mock('../../../electron/conversation/runtime/claudeRuntimeAdapter', () => ({
  adaptClaudeSdkMessage: vi.fn((message: unknown) => {
    const raw = message as Record<string, unknown>
    if (raw.type === 'system' && raw.subtype === 'init') {
      return [{
        kind: 'session.initialized',
        payload: {
          sessionRef: typeof raw.session_id === 'string' ? raw.session_id : undefined,
        },
      }]
    }
    if (raw.type === 'result') {
      return [{
        kind: 'turn.result',
        payload: {
          outcome: raw.subtype === 'success' ? 'success' : 'execution_error',
        },
      }]
    }
    return []
  }),
}))

beforeEach(() => {
  __setOpenClaudeModuleLoaderForTest(async () => ({
    query: vi.fn(() => createMockQuery()),
    // QueryLifecycle routes SDK query through the Session-first-class
    // API (ε.3a). Mock Session forwards back to createMockQuery so
    // existing assertions (mockClose, yieldQueue, emitMessage) keep
    // working. Migrated from `unstable_v2_createSession` to the stable
    // `createSession` name once the SDK exposed the clean surface.
    createSession: vi.fn((_options: Record<string, unknown>) => ({
      query: (_params: { prompt: AsyncIterable<unknown> }) => createMockQuery(),
      close: vi.fn(async () => {}),
    })),
  }))
})

function emitMessage(msg: unknown) {
  const pending = yieldQueue.shift()
  if (pending) {
    pending.resolve({ value: msg, done: false })
  }
}

async function waitForQueryPull(timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (yieldQueue.length === 0) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('mock query did not request next() in time')
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function endStream() {
  generatorDone = true
  for (const pending of yieldQueue) {
    pending.resolve({ value: undefined, done: true })
  }
  yieldQueue = []
}

function makeClaudeLaunchOptions() {
  return {
    maxTurns: 10,
    includePartialMessages: true,
    permissionMode: 'default',
    allowDangerouslySkipPermissions: true,
    env: {},
    systemPromptPayload: createProviderNativeSystemPrompt('TEST_SYSTEM_PROMPT'),
  }
}

describe('QueryLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts and yields messages from the SDK stream', async () => {
    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })

    const received: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const consuming = (async () => {
      for await (const envelope of stream) {
        const event = envelope.event as { kind: string; payload: Record<string, unknown> }
        received.push({ kind: event.kind, payload: event.payload })
      }
    })()

    await waitForQueryPull()
    emitMessage({ type: 'system', subtype: 'init', session_id: 'abc' })
    await waitForQueryPull()
    emitMessage({ type: 'result', subtype: 'success' })

    // ε.3d.2 — endStream ends the current turn's mock query (done:true)
    // but the outer lifecycle loop then awaits the queue for the next
    // turn. stop() breaks the outer loop and lets the consumer finish.
    await waitForQueryPull()
    endStream()
    await lifecycle.stop()
    await consuming

    expect(received.length).toBeGreaterThanOrEqual(2)
    expect(received[0].kind).toBe('session.initialized')
    expect(received[0].payload.sessionRef).toBe('abc')
    const resultEvent = received.find((e) => e.kind === 'turn.result')
    expect(resultEvent).toBeDefined()
    expect(resultEvent?.payload.outcome).toBe('success')
  })

  it('stop() before start() is idempotent and fast', async () => {
    const lifecycle = new QueryLifecycle()
    const start = Date.now()
    await lifecycle.stop()
    const elapsed = Date.now() - start
    expect(lifecycle.stopped).toBe(true)
    // Should resolve immediately, not wait for 30s safety timeout
    expect(elapsed).toBeLessThan(1000)
  })

  it('stop() during streaming calls query.close()', async () => {
    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })

    const consuming = (async () => {
      for await (const _msg of stream) {
        // consume
      }
    })()

    // ε.3d.2 — wait for the first turn's mock query to actually pull,
    // so _query is assigned on the lifecycle before we call stop().
    // Under the per-turn model each turn creates a fresh query; there
    // is no implicit "long-lived query exists from generator start"
    // anymore, so a test that wants to verify in-flight close must
    // explicitly wait for in-flight state.
    await waitForQueryPull()

    await lifecycle.stop()
    await consuming

    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(lifecycle.stopped).toBe(true)
  })

  it('natural completion calls close() to clean up child process', async () => {
    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })

    const consuming = (async () => {
      for await (const _msg of stream) {
        // consume
      }
    })()

    await waitForQueryPull()
    // ε.3d.2 — under the per-turn model, endStream() ends the current
    // turn's SDK query (done:true) but the OUTER lifecycle generator
    // returns to waiting on the queue for the next turn. Explicit
    // stop() is required to make the lifecycle finish and close the
    // current-turn query — this matches real production flow where
    // an upstream consumer decides when the session ends.
    endStream()
    await lifecycle.stop()
    await consuming

    expect(lifecycle.stopped).toBe(true)
    // mockClose is vi.fn that gets reset inside every createMockQuery()
    // call. With a single turn in this test the last query is the only
    // one whose close counter survives; stop() invoked close on it.
    expect(mockClose).toHaveBeenCalledTimes(1)

    // Subsequent stop() is idempotent — does NOT call close() again
    await lifecycle.stop()
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('pushMessage() after stop() is silently ignored', async () => {
    const lifecycle = new QueryLifecycle()
    await lifecycle.stop()
    lifecycle.pushMessage('ignored')
  })

  it('double stop() is safe', async () => {
    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })

    const consuming = (async () => {
      for await (const _msg of stream) {
        // consume
      }
    })()

    // ε.3d.2 — same rationale as "stop() during streaming" test.
    await waitForQueryPull()

    await lifecycle.stop()
    await lifecycle.stop()
    await consuming

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('start() throws if already started', () => {
    const lifecycle = new QueryLifecycle()
    lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })
    expect(() => lifecycle.start({ initialPrompt: 'again', launchOptions: makeClaudeLaunchOptions() })).toThrow('already started')
  })

  it('start() throws if already stopped', async () => {
    const lifecycle = new QueryLifecycle()
    await lifecycle.stop()
    expect(() => lifecycle.start({ initialPrompt: 'hello', launchOptions: makeClaudeLaunchOptions() })).toThrow('already stopped')
  })

})
