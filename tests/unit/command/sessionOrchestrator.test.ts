// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { SessionOrchestrator } from '../../../electron/command/sessionOrchestrator'
import type { OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'
import { ManagedSessionStore } from '../../../electron/services/managedSessionStore'
import {
  __resetCodexSdkLoaderForTest,
  __setCodexSdkLoaderForTest,
} from '../../../electron/command/codexQueryLifecycle'
import type { StartSessionInput, DataBusEvent } from '../../../src/shared/types'
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

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
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
    getActiveProviderMode: (_engineKind) => null,
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
    mockClose.mockReset()
    pendingNextResolvers = []
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns the same sessionId for duplicate startSession with same issueId', async () => {
    const input: StartSessionInput = {
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-1' },
      projectPath: '/tmp/project'
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

  it('supports starting a codex-managed session', async () => {
    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-1' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'codex-response' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({
      prompt: 'run with codex',
      engineKind: 'codex',
    })

    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }
    expect(info?.engineKind).toBe('codex')
    expect(info?.engineSessionRef).toBe('codex-thread-1')

    await orchestrator.stopSession(sessionId)
  })

  it('uses command.defaultEngine when startSession input omits engineKind', async () => {
    deps = makeDeps(db, tmpDir, 'codex')
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-default' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'default-engine-response' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({ prompt: 'use default engine' })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }
    expect(info?.engineKind).toBe('codex')
    expect(info?.engineSessionRef).toBe('codex-thread-default')

    await orchestrator.stopSession(sessionId)
  })

  it('passes provider-resolved codex auth config into Codex SDK constructor options', async () => {
    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      getCodexAuthConfig: async (_engineKind) => ({
        apiKey: 'codex-test-key',
        baseUrl: 'https://codex-gateway.example/v1',
      }),
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-auth' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'auth-configured' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({ prompt: 'use provider auth mapping' })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(info?.engineKind).toBe('codex')
    expect(codexMocks.mockCodexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'codex-test-key',
        baseUrl: 'https://codex-gateway.example/v1',
        env: expect.any(Object),
      }),
    )

    await orchestrator.stopSession(sessionId)
  })

  it('applies codex provider default model when session model is omitted', async () => {
    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      getProviderDefaultModel: (engineKind) =>
        engineKind === 'codex' ? 'gpt-5' : undefined,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-default-model' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'model-default' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({ prompt: 'use provider default model' })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(info?.engineKind).toBe('codex')
    expect(codexMocks.mockCodexStartThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5',
      }),
    )

    await orchestrator.stopSession(sessionId)
  })

  it('applies codex provider default reasoning effort when configured', async () => {
    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      getProviderDefaultReasoningEffort: (engineKind) =>
        engineKind === 'codex' ? 'high' : undefined,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-default-reasoning' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'reasoning-default' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({ prompt: 'use provider default reasoning effort' })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(info?.engineKind).toBe('codex')
    expect(codexMocks.mockCodexStartThread).toHaveBeenCalledWith(
      expect.objectContaining({
        modelReasoningEffort: 'high',
      }),
    )

    await orchestrator.stopSession(sessionId)
  })

  it('injects capability prompt into codex first-turn system prefix when CapabilityCenter is configured', async () => {
    const buildCapabilityPlan = vi.fn().mockResolvedValue(createCapabilityPlan())
    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      capabilityCenter: {
        buildCapabilityPlan,
      } as unknown as CapabilityCenter,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-capability-prompt' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'capability-injected' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const userPrompt = 'please update docs'
    const sessionId = await orchestrator.startSession({
      prompt: userPrompt,
      engineKind: 'codex',
    })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(buildCapabilityPlan).toHaveBeenCalled()
    expect(codexMocks.mockCodexRunStreamed).toHaveBeenCalled()
    const [firstPromptArg] = codexMocks.mockCodexRunStreamed.mock.calls[0]
    expect(firstPromptArg).toContain('<skill name="docs-sync">')
    expect(firstPromptArg).toContain(userPrompt)

    await orchestrator.stopSession(sessionId)
  })

  it('passes codex activated skill names from slash blocks into capability plan builder', async () => {
    const buildCapabilityPlan = vi.fn().mockResolvedValue(createCapabilityPlan())
    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      capabilityCenter: {
        buildCapabilityPlan,
      } as unknown as CapabilityCenter,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-activated-skill' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({
      prompt: [
        { type: 'text', text: 'please use this skill' },
        {
          type: 'slash_command',
          name: 'docs-sync',
          category: 'skill',
          label: 'docs-sync',
          expandedText: 'Sync docs before output',
        },
      ],
      engineKind: 'codex',
    })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(buildCapabilityPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          session: expect.objectContaining({
            engineKind: 'codex',
          }),
          activation: expect.objectContaining({
            explicitSkillNames: ['docs-sync'],
          }),
        }),
      }),
    )

    await orchestrator.stopSession(sessionId)
  })

  it('passes evose native allowlist to codex bridge when prompt activates an evose skill', async () => {
    const buildCapabilityPlan = vi.fn().mockResolvedValue(createCapabilityPlan())
    const bridgeRegisterSession = vi.fn().mockResolvedValue(undefined)
    const bridgeUnregisterSession = vi.fn().mockResolvedValue(undefined)

    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      capabilityCenter: {
        buildCapabilityPlan,
      } as unknown as CapabilityCenter,
      nativeCapabilityRegistry: {} as never,
      codexNativeBridgeManager: {
        registerSession: bridgeRegisterSession,
        unregisterSession: bridgeUnregisterSession,
      } as never,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-evose-allowlist' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({
      prompt: [
        {
          type: 'slash_command',
          name: 'evose:agent_github_iab8p2',
          category: 'skill',
          label: 'Agent - Github',
          execution: {
            nativeRequirements: [{ capability: 'evose' }],
            providerExecution: {
              provider: 'evose',
              appId: 'agent_github_iab8p2',
              appType: 'agent',
              gatewayTool: 'evose_run_agent',
            },
          },
          expandedText: 'Use this capability to run Evose Agent "Agent - Github".',
        },
      ],
      engineKind: 'codex',
    })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(bridgeRegisterSession).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeToolAllowlist: expect.arrayContaining([{ capability: 'evose' }]),
      }),
    )

    await orchestrator.stopSession(sessionId)
  })

  it('merges capability/custom/bridge MCP servers into codex config and unregisters bridge session', async () => {
    const nodeCmd = process.execPath
    const buildCapabilityPlan = vi.fn().mockResolvedValue(
      createCapabilityPlan({
        mcpServers: {
          docs: { command: nodeCmd, args: ['capability-docs.js'] },
          cap_only: { command: nodeCmd, args: ['capability-only.js'] },
        },
      }),
    )
    const bridgeRegisterSession = vi.fn().mockResolvedValue({
      [MCP_SERVER_BASE_NAME]: { command: nodeCmd, args: ['bridge-mcp.js'] },
    })
    const bridgeUnregisterSession = vi.fn().mockResolvedValue(undefined)

    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      capabilityCenter: {
        buildCapabilityPlan,
      } as unknown as CapabilityCenter,
      nativeCapabilityRegistry: {} as never,
      codexNativeBridgeManager: {
        registerSession: bridgeRegisterSession,
        unregisterSession: bridgeUnregisterSession,
      } as never,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-mcp-merge' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'merged-mcp' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({
      prompt: 'merge mcp servers',
      engineKind: 'codex',
      customMcpServers: {
        docs: { command: nodeCmd, args: ['custom-docs.js'] },
        custom_only: { command: nodeCmd, args: ['custom-only.js'] },
      },
    })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    expect(bridgeRegisterSession).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ sessionId }),
        nativeToolAllowlist: expect.arrayContaining([
          { capability: 'browser' },
          { capability: 'html' },
        ]),
        activeMcpServerNames: expect.any(Set),
      }),
    )

    const bridgeCallArg = bridgeRegisterSession.mock.calls[0]?.[0] as
      | { activeMcpServerNames?: ReadonlySet<string> }
      | undefined
    expect(bridgeCallArg?.activeMcpServerNames?.has('docs')).toBe(true)
    expect(bridgeCallArg?.activeMcpServerNames?.has('cap_only')).toBe(true)
    expect(bridgeCallArg?.activeMcpServerNames?.has('custom_only')).toBe(true)

    expect(codexMocks.mockCodexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          mcp_servers: expect.objectContaining({
            docs: { command: nodeCmd, args: ['custom-docs.js'] },
            cap_only: { command: nodeCmd, args: ['capability-only.js'] },
            custom_only: { command: nodeCmd, args: ['custom-only.js'] },
            [MCP_SERVER_BASE_NAME]: { command: nodeCmd, args: ['bridge-mcp.js'] },
          }),
        }),
      }),
    )

    await orchestrator.stopSession(sessionId)
    expect(bridgeUnregisterSession).toHaveBeenCalledWith(sessionId)
  })

  it('keeps capability MCP server when bridge registration is skipped by name collision', async () => {
    const nodeCmd = process.execPath
    const buildCapabilityPlan = vi.fn().mockResolvedValue(
      createCapabilityPlan({
        mcpServers: {
          [MCP_SERVER_BASE_NAME]: { command: nodeCmd, args: ['capability-owned-server.js'] },
        },
      }),
    )
    const bridgeRegisterSession = vi.fn().mockResolvedValue(undefined)
    const bridgeUnregisterSession = vi.fn().mockResolvedValue(undefined)

    deps = {
      ...makeDeps(db, tmpDir, 'codex'),
      capabilityCenter: {
        buildCapabilityPlan,
      } as unknown as CapabilityCenter,
      nativeCapabilityRegistry: {} as never,
      codexNativeBridgeManager: {
        registerSession: bridgeRegisterSession,
        unregisterSession: bridgeUnregisterSession,
      } as never,
    }
    orchestrator = new SessionOrchestrator(deps)

    codexMocks.state.turnPlans.push([
      { type: 'thread.started', thread_id: 'codex-thread-mcp-collision' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'collision-ok' } },
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
    ])

    const sessionId = await orchestrator.startSession({
      prompt: 'collision case',
      engineKind: 'codex',
    })
    let info = await orchestrator.getSession(sessionId)
    for (let i = 0; i < 10 && info?.engineSessionRef == null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      info = await orchestrator.getSession(sessionId)
    }

    const bridgeCallArg = bridgeRegisterSession.mock.calls[0]?.[0] as
      | { activeMcpServerNames?: ReadonlySet<string> }
      | undefined
    expect(bridgeCallArg?.activeMcpServerNames?.has(MCP_SERVER_BASE_NAME)).toBe(true)
    expect(codexMocks.mockCodexCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          mcp_servers: expect.objectContaining({
            [MCP_SERVER_BASE_NAME]: { command: nodeCmd, args: ['capability-owned-server.js'] },
          }),
        }),
      }),
    )

    await orchestrator.stopSession(sessionId)
    expect(bridgeUnregisterSession).toHaveBeenCalledWith(sessionId)
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
    mockClose.mockReset()
    pendingNextResolvers = []
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    __resetCodexSdkLoaderForTest()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('calls lifecycle.stop() which invokes query.close()', async () => {
    const id = await orchestrator.startSession({ prompt: 'test' })

    // Wait until QueryLifecycle has started and issued at least one next() pull.
    // Without this, stopSession may race before lifecycle.start() is reached,
    // making close() legitimately unnecessary for this particular timing.
    for (let i = 0; i < 500 && pendingNextResolvers.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(pendingNextResolvers.length).toBeGreaterThan(0)

    await orchestrator.stopSession(id)

    expect(mockClose).toHaveBeenCalledTimes(1)
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
    mockClose.mockReset()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
    await orchestrator.shutdown()
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
      getActiveProviderMode: (_engineKind) => activeProviderMode as ReturnType<OrchestratorDeps['getActiveProviderMode']>,
    }
    orchestrator = new SessionOrchestrator(deps)
    __setCodexSdkLoaderForTest(
      async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
    )
    mockClose.mockReset()
    codexMocks.state.turnPlans = []
    codexMocks.mockCodexRunStreamed.mockClear()
    codexMocks.mockCodexStartThread.mockClear()
    codexMocks.mockCodexResumeThread.mockClear()
    codexMocks.mockCodexCtor.mockClear()
  })

  afterEach(async () => {
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
})
