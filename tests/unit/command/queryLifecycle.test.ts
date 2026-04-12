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
    const iter = stream[Symbol.asyncIterator]()

    // Call next() first (starts generator, blocks on mock), then emit to resolve
    const p1 = iter.next()
    await waitForQueryPull()
    emitMessage({ type: 'system', subtype: 'init', session_id: 'abc' })
    const r1 = await p1
    expect(r1.done).toBe(false)
    const event1 = r1.value as { event?: { kind?: string; payload?: { sessionRef?: string } } }
    expect(event1.event?.kind).toBe('session.initialized')
    expect(event1.event?.payload?.sessionRef).toBe('abc')

    const p2 = iter.next()
    await waitForQueryPull()
    emitMessage({ type: 'result', subtype: 'success' })
    const r2 = await p2
    expect(r2.done).toBe(false)
    const event2 = r2.value as { event?: { kind?: string; payload?: { outcome?: string } } }
    expect(event2.event?.kind).toBe('turn.result')
    expect(event2.event?.payload?.outcome).toBe('success')

    // Clean up
    endStream()
    await iter.next() // should return done: true
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
    endStream()
    await consuming

    expect(lifecycle.stopped).toBe(true)
    // Natural completion MUST call close() to prevent fd leaks (spawn EBADF)
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
