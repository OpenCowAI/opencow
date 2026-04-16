// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryLifecycle, __setOpenClaudeModuleLoaderForTest } from '../../../electron/command/queryLifecycle'
import { createProviderNativeSystemPrompt } from '../../../electron/command/systemPromptTransport'
import type { ManagedSessionMessage } from '../../../src/shared/types'

// Mock SDK query — returns an async generator that we can control
const mockClose = vi.fn()
let yieldQueue: Array<{ resolve: (v: IteratorResult<unknown>) => void }> = []
let generatorDone = false

// Per-test capture of session.query() invocations (one entry per turn).
// Mutated by the mocked createSession → session.query(); new tests read it
// to assert on `options.initialMessages` / `options.env` passed per turn.
let capturedQueryCalls: Array<{ options: Record<string, unknown> | undefined }> = []

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
      query: (params: {
        prompt: AsyncIterable<unknown>
        options?: Record<string, unknown>
      }) => {
        capturedQueryCalls.push({ options: params.options })
        return createMockQuery()
      },
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

/**
 * Build a fully-typed SessionLifecycleStartInput.
 *
 * Per-turn replay requires `getSessionMessages` as a required field (see
 * plans/per-turn-history-replay.md). Tests that don't care about replay
 * can pass the default empty-history getter; tests that exercise replay
 * override `getMessages`.
 */
function makeStartInput(params: {
  initialPrompt?: string
  getMessages?: () => readonly ManagedSessionMessage[]
} = {}) {
  return {
    initialPrompt: params.initialPrompt ?? 'hello',
    launchOptions: makeClaudeLaunchOptions(),
    getSessionMessages: params.getMessages ?? ((): readonly ManagedSessionMessage[] => []),
  }
}

describe('QueryLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedQueryCalls = []
  })

  it('starts and yields messages from the SDK stream', async () => {
    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start(makeStartInput())

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
    const stream = lifecycle.start(makeStartInput())

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
    const stream = lifecycle.start(makeStartInput())

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
    const stream = lifecycle.start(makeStartInput())

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
    lifecycle.start(makeStartInput())
    expect(() => lifecycle.start(makeStartInput({ initialPrompt: 'again' }))).toThrow('already started')
  })

  it('start() throws if already stopped', async () => {
    const lifecycle = new QueryLifecycle()
    await lifecycle.stop()
    expect(() => lifecycle.start(makeStartInput())).toThrow('already stopped')
  })

  // ── ε.3d.2 follow-up — per-turn history replay ────────────────────────
  // Regression coverage for ccb-2IZ4L16u3aIW (and ccb-p-IDyPZVFH4G,
  // ccb-IcC5mfq4EvOA). Design doc: plans/per-turn-history-replay.md.

  it('does NOT pass initialMessages on the first turn when history contains only the initial prompt', async () => {
    // On the very first turn, `session.getMessages()` returns
    // [initialPrompt_user]; `.slice(0, -1)` is empty; no history to replay.
    const lifecycle = new QueryLifecycle()
    const initialUser: ManagedSessionMessage = {
      id: 'u-1',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'hello' }],
    }
    const stream = lifecycle.start(makeStartInput({
      getMessages: () => [initialUser],
    }))

    const consuming = (async () => {
      for await (const _e of stream) { /* consume */ }
    })()
    await waitForQueryPull()
    await lifecycle.stop()
    await consuming

    expect(capturedQueryCalls).toHaveLength(1)
    const firstTurn = capturedQueryCalls[0]!.options
    // Either absent or empty, never non-empty on the first turn with only the prompt.
    expect(firstTurn?.initialMessages).toBeUndefined()
  })

  it('replays full history MINUS the trailing user prompt on subsequent turns', async () => {
    // ccb-2IZ4L16u3aIW repro: when user says "我们上面聊了什么" as turn 5,
    // turn 5's session.query() must see turns 0..4 as initialMessages so
    // the model can answer the recap question. The trailing entry (the new
    // user prompt) must be excluded because QueryEngine.submitMessage
    // appends the prompt to mutableMessages on its own — including it in
    // initialMessages would duplicate the user turn.
    const lifecycle = new QueryLifecycle()

    let messageState: ManagedSessionMessage[] = [
      { id: 'u-0', role: 'user', timestamp: 1, content: [{ type: 'text', text: '每天 9 点分析桌面文件' }] },
    ]

    const stream = lifecycle.start(makeStartInput({
      initialPrompt: '每天 9 点分析桌面文件',
      getMessages: () => messageState,
    }))

    const consuming = (async () => {
      for await (const _e of stream) { /* consume */ }
    })()

    // Turn 1 (initial) — mock query has pulled; simulate effectProjector
    // appending assistant entries during turn 1, then end the turn's SDK
    // generator so the outer lifecycle loop advances to the next queue item.
    await waitForQueryPull()
    messageState = [
      ...messageState,
      { id: 'a-1', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: '已创建 ✅' }] },
    ]
    endStream() // end turn 1's mock query; outer loop returns to queue await

    // User sends turn 2. In production, sessionOrchestrator.pushToActiveSession
    // calls session.addMessage BEFORE lifecycle.pushMessage (both sync, in the
    // same sync block, so the DB is updated before the queue consumer's
    // microtask fires). Mirror that ordering here by updating messageState
    // first, then pushing to the queue.
    messageState = [
      ...messageState,
      { id: 'u-1', role: 'user', timestamp: 3, content: [{ type: 'text', text: '我们上面聊了什么' }] },
    ]
    lifecycle.pushMessage('我们上面聊了什么')

    // Wait for turn 2's session.query() to be invoked.
    await waitForQueryPull()

    await lifecycle.stop()
    await consuming

    expect(capturedQueryCalls).toHaveLength(2)

    // Turn 1: only initialPrompt_user in history → slice → empty, no replay.
    expect(capturedQueryCalls[0]!.options?.initialMessages).toBeUndefined()

    // Turn 2: history [u-0, a-1, u-1]; slice(0,-1) = [u-0, a-1] → replayed.
    const turn2 = capturedQueryCalls[1]!.options as {
      initialMessages?: Array<{ type: string; message: { role: string; content: unknown } }>
    }
    expect(turn2.initialMessages).toBeDefined()
    expect(turn2.initialMessages).toHaveLength(2)
    // First entry: the original user turn 0; last entry: the assistant turn 1.
    // The CURRENT user turn ("我们上面聊了什么") must NOT appear — it's the
    // prompt being submitted, excluded by the .slice(0, -1) in queryLifecycle.
    expect(turn2.initialMessages![0]!.message.role).toBe('user')
    expect(turn2.initialMessages![1]!.message.role).toBe('assistant')
    // Sanity: the replayed user message is turn 0, not turn 2.
    expect(turn2.initialMessages![0]!.message.content).toBe('每天 9 点分析桌面文件')
  })

  it('env overlay from resolveTurnOptions coexists with initialMessages', async () => {
    // The per-turn options bag must carry BOTH env (fresh provider creds)
    // and initialMessages (history replay) when both are applicable.
    const lifecycle = new QueryLifecycle()
    let messageState: ManagedSessionMessage[] = [
      { id: 'u-0', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'first' }] },
      { id: 'a-1', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'ok' }] },
      { id: 'u-1', role: 'user', timestamp: 3, content: [{ type: 'text', text: 'second' }] },
    ]

    const stream = lifecycle.start({
      initialPrompt: 'first',
      launchOptions: makeClaudeLaunchOptions(),
      getSessionMessages: () => messageState,
      resolveTurnOptions: async () => ({ env: { PROVIDER_KEY: 'secret' } }),
    })

    const consuming = (async () => {
      for await (const _e of stream) { /* consume */ }
    })()

    await waitForQueryPull()
    endStream() // end turn 1 so the outer lifecycle loop advances to turn 2

    // Second turn push (addMessage-before-pushMessage order, see rationale
    // in the preceding test)
    messageState = [
      ...messageState,
      { id: 'u-2', role: 'user', timestamp: 4, content: [{ type: 'text', text: 'third' }] },
    ]
    lifecycle.pushMessage('third')
    await waitForQueryPull()

    await lifecycle.stop()
    await consuming

    // Second turn must carry BOTH env and initialMessages.
    const turn2 = capturedQueryCalls[1]!.options as {
      env?: Record<string, string>
      initialMessages?: unknown[]
    }
    expect(turn2.env).toEqual({ PROVIDER_KEY: 'secret' })
    expect(turn2.initialMessages).toBeDefined()
    expect(Array.isArray(turn2.initialMessages)).toBe(true)
  })

  it('calls getSessionMessages fresh on each turn (not a one-time snapshot)', async () => {
    // Regression guard: an earlier implementation idea was to snapshot
    // `getSessionMessages()` once at start(). That would miss every
    // assistant / tool_result mutation persisted after start() fires.
    // The getter MUST be invoked per turn.
    const getMessages = vi.fn((): readonly ManagedSessionMessage[] => [])

    const lifecycle = new QueryLifecycle()
    const stream = lifecycle.start(makeStartInput({ getMessages }))

    const consuming = (async () => {
      for await (const _e of stream) { /* consume */ }
    })()

    await waitForQueryPull()
    endStream() // end turn 1
    lifecycle.pushMessage('turn2')
    await waitForQueryPull()
    endStream() // end turn 2
    lifecycle.pushMessage('turn3')
    await waitForQueryPull()

    await lifecycle.stop()
    await consuming

    // Called once per turn — 3 turns → 3 calls (or more if queryLifecycle
    // evolves to call it multiple times per turn; either way NEVER a single
    // snapshot).
    expect(getMessages.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

})
