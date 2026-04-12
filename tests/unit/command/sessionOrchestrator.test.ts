// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { SessionOrchestrator } from '../../../electron/command/sessionOrchestrator'
import type { OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'
import { ManagedSessionStore } from '../../../electron/services/managedSessionStore'
import { __setOpenClaudeModuleLoaderForTest } from '../../../electron/command/queryLifecycle'
// Codex engine removed — stub test helpers
const __resetCodexSdkLoaderForTest = (): void => {}
const __setCodexSdkLoaderForTest = (_loader: unknown): void => {}
import type { StartSessionInput, DataBusEvent, ManagedSessionInfo } from '../../../src/shared/types'
import type { Database } from '../../../electron/database/types'
import type { CapabilityCenter } from '../../../electron/services/capabilityCenter'
import type { CapabilityPlan } from '../../../electron/services/capabilityCenter/sessionInjector'
import { MCP_SERVER_BASE_NAME } from '../../../src/shared/appIdentity'

vi.mock('electron', () => ({
  app: { isPackaged: false },
}))

// Mock the SDK query — returns a controllable async generator with full Query interface
const mockClose = vi.fn()
let pendingNextResolvers: Array<(v: IteratorResult<unknown>) => void> = []

function installClaudeQueryMock(): void {
  mockClose.mockReset()
  pendingNextResolvers = []

  __setOpenClaudeModuleLoaderForTest(async () => ({
    query: vi.fn(() => {
      pendingNextResolvers = []

      const generator = {
        next: () =>
          new Promise<IteratorResult<unknown>>((resolve) => {
            pendingNextResolvers.push(resolve)
          }),
        return: () => {
          for (const resolve of pendingNextResolvers) {
            resolve({ value: undefined, done: true })
          }
          pendingNextResolvers = []
          return Promise.resolve({ value: undefined, done: true as const })
        },
        throw: (e: unknown) => Promise.reject(e),
        [Symbol.asyncIterator]: () => generator,
        close: () => {
          mockClose()
          // Resolve all pending next() calls to unblock the for-await loop
          for (const resolve of pendingNextResolvers) {
            resolve({ value: undefined, done: true })
          }
          pendingNextResolvers = []
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
        stopTask: () => Promise.resolve(),
      }

      return generator
    }),
  }))
}

/*
vi.mock('../../../electron/integrations/opencowSdkCompat', () => ({
  query: vi.fn(() => {
    pendingNextResolvers = []

    const generator = {
      next: () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          pendingNextResolvers.push(resolve)
        }),
      return: () => {
        for (const resolve of pendingNextResolvers) {
          resolve({ value: undefined, done: true })
        }
        pendingNextResolvers = []
        return Promise.resolve({ value: undefined, done: true as const })
      },
      throw: (e: unknown) => Promise.reject(e),
      [Symbol.asyncIterator]: () => generator,
      close: () => {
        mockClose()
        // Resolve all pending next() calls to unblock the for-await loop
        for (const resolve of pendingNextResolvers) {
          resolve({ value: undefined, done: true })
        }
        pendingNextResolvers = []
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
  })
}))
*/


const codexMocks = vi.hoisted(() => {
  const state = {
    turnPlans: [] as Array<unknown[]>,
  }

  const mockCodexRunStreamed = vi.fn(async (_input: string, _options?: { signal?: AbortSignal }) => {
    const events = state.turnPlans.shift() ?? []
    return {
      events: (async function* () {
        for (const event of events) {
          yield event
        }
      })(),
    }
  })

  const mockCodexThread = {
    runStreamed: mockCodexRunStreamed,
  }

  const mockCodexStartThread = vi.fn(() => mockCodexThread)
  const mockCodexResumeThread = vi.fn(() => mockCodexThread)
  const mockCodexCtor = vi.fn(function MockCodex() {
    return {
      startThread: mockCodexStartThread,
      resumeThread: mockCodexResumeThread,
    }
  })

  return {
    state,
    mockCodexRunStreamed,
    mockCodexStartThread,
    mockCodexResumeThread,
    mockCodexCtor,
  }
})

function makeDeps(
  db: Kysely<Database>,
  _dataDir: string,
  defaultEngine: 'claude' | 'codex' = 'claude',
): OrchestratorDeps {
  return {
    dispatch: vi.fn(),
    getProxyEnv: () => ({}),
    getProviderEnv: async (engineKind) => (engineKind === 'codex' ? { OPENAI_API_KEY: 'test-openai-key' } : {}),
    getCodexAuthConfig: async (_engineKind) => null,
    getProviderDefaultModel: (_engineKind) => undefined,
    getProviderDefaultReasoningEffort: (_engineKind) => undefined,
    getActiveProviderProfileId: () => null,
    getCommandDefaults: () => ({
      maxTurns: 10,
      permissionMode: 'default' as const,
      defaultEngine,
    }),
    store: new ManagedSessionStore(db)
  }
}

function createCapabilityPlan(overrides: Partial<CapabilityPlan> = {}): CapabilityPlan {
  return {
    capabilityPrompt: '<skill name="docs-sync">Sync docs before writing.</skill>',
    agentPrompt: null,
    declarativeHooks: {},
    mcpServers: {},
    nativeRequirements: [],
    totalChars: 56,
    summary: {
      skills: ['docs-sync'],
      agent: null,
      rules: [],
      hooks: [],
      mcpServers: [],
      skippedDistributed: [],
      skippedByBudget: [],
      skillDecisions: [],
    },
    ...overrides,
  }
}

function makePersistedSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  const now = Date.now()
  return {
    id: `ccb-persisted-${Math.random().toString(36).slice(2, 8)}`,
    engineKind: 'claude',
    engineSessionRef: 'claude-session-ref',
    engineState: null,
    state: 'idle',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
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
    activity: null,
    error: null,
    executionContext: null,
    ...overrides,
  }
}

describe('SessionOrchestrator.startSession — idempotency', () => {
  let orchestrator: SessionOrchestrator
  let deps: OrchestratorDeps
  let tmpDir: string
  let db: Kysely<Database>
  let closeDb: () => Promise<void>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ccb-test-'))
    ;({ db, close: closeDb } = await createTestDb())
    deps = makeDeps(db, tmpDir)
    orchestrator = new SessionOrchestrator(deps)
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    installClaudeQueryMock()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    __setOpenClaudeModuleLoaderForTest(null)
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns the same sessionId for duplicate startSession with same issueId', async () => {
    const input: StartSessionInput = {
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-1' },
      workspace: { scope: 'custom-path', cwd: tmpDir },
    }

    const id1 = await orchestrator.startSession(input)
    const id2 = await orchestrator.startSession(input)

    expect(id1).toBe(id2)
  })

  it('dispatches session:created only once for idempotent calls', async () => {
    const input: StartSessionInput = {
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-1' }
    }

    await orchestrator.startSession(input)
    await orchestrator.startSession(input)

    const createdEvents = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([e]: [DataBusEvent]) => e.type === 'command:session:created')
    expect(createdEvents).toHaveLength(1)
  })

  it('allows new session after previous one is stopped', async () => {
    const input: StartSessionInput = {
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-1' }
    }

    const id1 = await orchestrator.startSession(input)
    await orchestrator.stopSession(id1)

    const id2 = await orchestrator.startSession(input)
    expect(id2).not.toBe(id1)
  })

  it('allows different issueIds to create separate sessions', async () => {
    const id1 = await orchestrator.startSession({
      prompt: 'Fix bug A',
      origin: { source: 'issue', issueId: 'issue-1' }
    })
    const id2 = await orchestrator.startSession({
      prompt: 'Fix bug B',
      origin: { source: 'issue', issueId: 'issue-2' }
    })

    expect(id1).not.toBe(id2)
  })

  it('allows session without issueId (no idempotency check)', async () => {
    const id1 = await orchestrator.startSession({ prompt: 'prompt 1' })
    const id2 = await orchestrator.startSession({ prompt: 'prompt 2' })

    expect(id1).not.toBe(id2)
  })

  it('uses home as initial execution cwd for global (all-projects) session', async () => {
    const sessionId = await orchestrator.startSession({ prompt: 'global session cwd check' })

    // Wait until lifecycle enters next() so we can emit an init event.
    for (let i = 0; i < 20 && pendingNextResolvers.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    if (pendingNextResolvers.length > 0) {
      pendingNextResolvers[0]({
        value: { type: 'system', subtype: 'init', session_id: 'test-ref-home', model: 'claude-sonnet-4-6' },
        done: false,
      })
      pendingNextResolvers.splice(0, 1)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const updatedEvents = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]: [DataBusEvent]) => event)
      .filter(
        (event): event is Extract<DataBusEvent, { type: 'command:session:updated' }> =>
          event.type === 'command:session:updated' && event.payload.id === sessionId,
      )

    const withExecutionContext = [...updatedEvents]
      .reverse()
      .find((event) => event.payload.executionContext !== null)

    expect(withExecutionContext).toBeTruthy()
    expect(withExecutionContext?.payload.executionContext?.cwd).toBe(homedir())
  })
})

describe('SessionOrchestrator.stopSession — deterministic cleanup', () => {
  let orchestrator: SessionOrchestrator
  let deps: OrchestratorDeps
  let tmpDir: string
  let db: Kysely<Database>
  let closeDb: () => Promise<void>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ccb-test-'))
    ;({ db, close: closeDb } = await createTestDb())
    deps = makeDeps(db, tmpDir)
    orchestrator = new SessionOrchestrator(deps)
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    installClaudeQueryMock()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    __setOpenClaudeModuleLoaderForTest(null)
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('calls lifecycle.stop() which invokes query.close()', async () => {
    let queryCreated = false
    let closeCalled = 0
    __setOpenClaudeModuleLoaderForTest(async () => ({
      query: vi.fn(() => {
        queryCreated = true
        let pendingNextResolve: ((v: IteratorResult<unknown>) => void) | null = null
        const generator = {
          next: () =>
            new Promise<IteratorResult<unknown>>((resolve) => {
              pendingNextResolve = resolve
            }),
          return: () => Promise.resolve({ value: undefined, done: true as const }),
          throw: (e: unknown) => Promise.reject(e),
          [Symbol.asyncIterator]: () => generator,
          close: () => {
            closeCalled += 1
            pendingNextResolve?.({ value: undefined, done: true })
            pendingNextResolve = null
          },
        }
        return generator
      }),
    }))

    const id = await orchestrator.startSession({ prompt: 'test' })

    for (let i = 0; i < 200 && !queryCreated; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(queryCreated).toBe(true)

    await orchestrator.stopSession(id)

    expect(closeCalled).toBe(1)
  })

  it('removes session from active map after stop', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })
    await orchestrator.stopSession(id)

    // Session should be persisted as stopped
    expect((await orchestrator.getSession(id))?.state).toBe('stopped')
  })

  it('dispatches session:stopped event', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })
    await orchestrator.stopSession(id)

    const stoppedEvents = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([e]: [DataBusEvent]) => e.type === 'command:session:stopped')
    expect(stoppedEvents).toHaveLength(1)
    expect(stoppedEvents[0][0].payload.sessionId).toBe(id)
    expect(stoppedEvents[0][0].payload.origin).toEqual({ source: 'agent' })
    expect(stoppedEvents[0][0].payload.stopReason).toBe('user_stopped')
  })

  it('dispatches finalized assistant message before session:stopped when stopping active stream', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })
    const runtimes = (orchestrator as unknown as {
      runtimes: Map<string, { session: { addMessage: (role: 'assistant' | 'user', blocks: unknown[], isStreaming?: boolean) => string } }>
    }).runtimes
    const rt = runtimes.get(id)
    expect(rt).toBeTruthy()
    if (rt) {
      rt.session.addMessage('assistant', [{ type: 'text', text: 'streaming response' }], true)
    }
    await orchestrator.stopSession(id)

    const events = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]: [DataBusEvent]) => event)
      .filter((event) => event.type === 'command:session:message' || event.type === 'command:session:stopped')

    const stoppedIndex = events.findIndex((event) => event.type === 'command:session:stopped')
    expect(stoppedIndex).toBeGreaterThanOrEqual(0)

    const finalizedMessage = events
      .slice(0, stoppedIndex)
      .reverse()
      .find(
        (event): event is Extract<DataBusEvent, { type: 'command:session:message' }> =>
          event.type === 'command:session:message' &&
          event.payload.sessionId === id &&
          event.payload.message.role === 'assistant' &&
          event.payload.message.isStreaming === false,
      )

    expect(finalizedMessage).toBeTruthy()
  })

  it('ignores late runtime partial events after manual stop (no streaming resurrection)', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })
    const runtimes = (orchestrator as unknown as {
      runtimes: Map<string, { session: { addMessage: (role: 'assistant' | 'user', blocks: unknown[], isStreaming?: boolean) => string } }>
    }).runtimes
    const rt = runtimes.get(id)
    expect(rt).toBeTruthy()
    let streamMsgId: string | null = null
    if (rt) {
      streamMsgId = rt.session.addMessage('assistant', [{ type: 'text', text: 'streaming response' }], true)
    }
    expect(streamMsgId).toBeTruthy()

    await orchestrator.stopSession(id)

    // Simulate a buffered SDK partial event that arrives after stop.
    if (pendingNextResolvers.length > 0) {
      pendingNextResolvers[0]({
        value: {
          type: 'assistant',
          subtype: 'partial',
          message: {
            content: [{ type: 'text', text: 'late partial after stop' }],
          },
        },
        done: false,
      })
      pendingNextResolvers.splice(0, 1)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    const events = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]: [DataBusEvent]) => event)
      .filter((event): event is Extract<DataBusEvent, { type: 'command:session:message' }> => event.type === 'command:session:message')
      .filter((event) => event.payload.sessionId === id && event.payload.message.role === 'assistant')

    expect(events.some((event) => event.payload.message.isStreaming === true)).toBe(false)
  })

  it('cleans runtime entry on stopSession', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })
    const runtimes = (orchestrator as unknown as { runtimes: Map<string, unknown> }).runtimes
    expect(runtimes.has(id)).toBe(true)

    await orchestrator.stopSession(id)
    expect(runtimes.has(id)).toBe(false)
  })

  it('clears all runtime entries on shutdown', async () => {
    await orchestrator.startSession({ prompt: 'test' })
    const runtimes = (orchestrator as unknown as { runtimes: Map<string, unknown> }).runtimes
    expect(runtimes.size).toBeGreaterThan(0)

    await orchestrator.shutdown()
    expect(runtimes.size).toBe(0)
  })
})

describe('SessionOrchestrator.handleSessionError — transient spawn errors', () => {
  let orchestrator: SessionOrchestrator
  let deps: OrchestratorDeps
  let tmpDir: string
  let db: Kysely<Database>
  let closeDb: () => Promise<void>

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ccb-test-'))
    ;({ db, close: closeDb } = await createTestDb())
    deps = makeDeps(db, tmpDir)
    orchestrator = new SessionOrchestrator(deps)
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    installClaudeQueryMock()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    __setOpenClaudeModuleLoaderForTest(null)
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('dispatches command:session:idle when transient spawn error is downgraded to idle', async () => {
    const sessionId = await orchestrator.startSession({ prompt: 'trigger transient path' })
    const transientError = Object.assign(new Error('too many open files'), { code: 'EMFILE' })

    await (
      orchestrator as unknown as {
        handleSessionError: (id: string, err: unknown) => Promise<void>
      }
    ).handleSessionError(sessionId, transientError)

    const idleEvents = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]: [DataBusEvent]) => event)
      .filter((event): event is Extract<DataBusEvent, { type: 'command:session:idle' }> => event.type === 'command:session:idle')
      .filter((event) => event.payload.sessionId === sessionId)

    expect(idleEvents).toHaveLength(1)
    expect(idleEvents[0].payload.origin).toEqual({ source: 'agent' })
    expect(idleEvents[0].payload.stopReason).toBe('completed')
  })
})

describe('SessionOrchestrator.sendMessage — provider mode drift detection', () => {
  let orchestrator: SessionOrchestrator
  let deps: OrchestratorDeps
  let tmpDir: string
  let db: Kysely<Database>
  let closeDb: () => Promise<void>
  let activeProviderMode: string | null = null

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ccb-test-'))
    ;({ db, close: closeDb } = await createTestDb())
    activeProviderMode = 'openrouter'
    deps = {
      ...makeDeps(db, tmpDir),
      getActiveProviderProfileId: () => activeProviderMode as ReturnType<OrchestratorDeps['getActiveProviderProfileId']>,
    }
    orchestrator = new SessionOrchestrator(deps)
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    installClaudeQueryMock()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    __setOpenClaudeModuleLoaderForTest(null)
    await orchestrator.shutdown()
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('forces lifecycle restart when provider mode changes between messages', async () => {
    const sessionId = await orchestrator.startSession({
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-drift-1' },
    })

    // Wait for the lifecycle's for-await loop to call next() on the mock query
    for (let i = 0; i < 20 && pendingNextResolvers.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Resolve the init event so the session gets an engineSessionRef
    // (required for resumeSessionInternal to succeed)
    if (pendingNextResolvers.length > 0) {
      pendingNextResolvers[0]({
        value: { type: 'system', subtype: 'init', session_id: 'test-ref-drift-1', model: 'claude-sonnet-4-6' },
        done: false,
      })
      pendingNextResolvers.splice(0, 1)
      // Give the event loop time to process the event through the pipeline
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    // Simulate user switching provider mode mid-session
    activeProviderMode = 'custom'

    const result = await orchestrator.sendMessage(sessionId, 'Continue with new provider')
    expect(result).toBe(true)

    // Verify that a 'creating' state was dispatched (indicating lifecycle restart)
    const creatingEvents = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([event]: [DataBusEvent]) => event)
      .filter((event): event is Extract<DataBusEvent, { type: 'command:session:updated' }> =>
        event.type === 'command:session:updated'
      )
      .filter((event) => event.payload.state === 'creating')

    // At least 1 creating event from the sendMessage restart path
    // (initial startSession uses session:created, not session:updated)
    expect(creatingEvents.length).toBeGreaterThanOrEqual(1)

  })

  it('does not restart when provider mode has not changed', async () => {
    const sessionId = await orchestrator.startSession({
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-drift-2' },
    })

    // Wait for the lifecycle's for-await loop to call next() on the mock query
    for (let i = 0; i < 20 && pendingNextResolvers.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Resolve the init event so the session transitions to streaming
    if (pendingNextResolvers.length > 0) {
      pendingNextResolvers[0]({
        value: { type: 'system', subtype: 'init', session_id: 'test-ref-drift-2', model: 'claude-sonnet-4-6' },
        done: false,
      })
      pendingNextResolvers.splice(0, 1)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    // Provider mode stays the same
    const dispatchCountBefore = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls.length

    await orchestrator.sendMessage(sessionId, 'Continue with same provider')

    // Should NOT see a new 'creating' event after the initial one
    const creatingEventsAfter = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .slice(dispatchCountBefore)
      .map(([event]: [DataBusEvent]) => event)
      .filter((event): event is Extract<DataBusEvent, { type: 'command:session:updated' }> =>
        event.type === 'command:session:updated'
      )
      .filter((event) => event.payload.state === 'creating')

    expect(creatingEventsAfter).toHaveLength(0)
  })

  it('injects initialMessages when forced resume restart has engine session ref', async () => {
    const now = Date.now()
    const persistedSession = makePersistedSession({
      id: 'ccb-persisted-history-seed',
      state: 'idle',
      engineKind: 'claude',
      engineSessionRef: 'claude-history-ref',
      messages: [
        {
          id: 'u-1',
          role: 'user',
          timestamp: now - 2_000,
          content: [{ type: 'text', text: 'previous user' }],
        },
        {
          id: 'a-1',
          role: 'assistant',
          timestamp: now - 1_000,
          content: [{ type: 'text', text: 'previous assistant' }],
        },
      ],
    })
    await deps.store.save(persistedSession)

    let capturedOptions: Record<string, unknown> | undefined
    __setOpenClaudeModuleLoaderForTest(async () => ({
      query: vi.fn((params: { options?: Record<string, unknown> }) => {
        capturedOptions = params.options
        return {
          async *[Symbol.asyncIterator]() {
            // no-op stream
          },
          close() {
            // no-op
          },
        }
      }),
    }))

    const resumed = await orchestrator.sendMessage(persistedSession.id, 'resume with history')
    expect(resumed).toBe(true)

    for (let i = 0; i < 20 && !capturedOptions; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const initialMessages = capturedOptions?.initialMessages as unknown[] | undefined
    expect(Array.isArray(initialMessages)).toBe(true)
    expect((initialMessages ?? []).length).toBeGreaterThan(1)

    __setOpenClaudeModuleLoaderForTest(null)
  })

  it('injects initialMessages when restart uses skipAddMessage path (no resume ref)', async () => {
    const now = Date.now()
    const persistedSession = makePersistedSession({
      id: 'ccb-persisted-history-seed-skip-add',
      state: 'idle',
      engineKind: 'claude',
      engineSessionRef: null,
      messages: [
        {
          id: 'u-1',
          role: 'user',
          timestamp: now - 2_000,
          content: [{ type: 'text', text: 'old user' }],
        },
        {
          id: 'a-1',
          role: 'assistant',
          timestamp: now - 1_000,
          content: [{ type: 'text', text: 'old assistant' }],
        },
      ],
    })
    await deps.store.save(persistedSession)

    let capturedOptions: Record<string, unknown> | undefined
    __setOpenClaudeModuleLoaderForTest(async () => ({
      query: vi.fn((params: { options?: Record<string, unknown> }) => {
        capturedOptions = params.options
        return {
          async *[Symbol.asyncIterator]() {
            // no-op stream
          },
          close() {
            // no-op
          },
        }
      }),
    }))

    const resumed = await (orchestrator as unknown as {
      resumeSessionInternal: (
        sessionId: string,
        message: string,
        options: { forceRestart: boolean },
      ) => Promise<boolean>
    }).resumeSessionInternal(persistedSession.id, 'restart without resume ref', { forceRestart: true })

    expect(resumed).toBe(true)

    for (let i = 0; i < 20 && !capturedOptions; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const initialMessages = capturedOptions?.initialMessages as unknown[] | undefined
    expect(Array.isArray(initialMessages)).toBe(true)
    expect((initialMessages ?? []).length).toBeGreaterThan(1)

    __setOpenClaudeModuleLoaderForTest(null)
  })
})
