// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
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
import type { Database } from '../../../electron/database/types'

vi.mock('electron', () => ({
  app: { isPackaged: false },
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
    store: new ManagedSessionStore(db),
  }
}

describe('ExecutionContextCoordinator integration', () => {
  it('prefers newer event timestamp even when older callback arrives later', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opencow-coordinator-it-'))
    const { db, close } = await createTestDb()

    try {
      const startupPath = tmpDir
      const runtimePath = join(tmpdir(), 'opencow-event-time-wins')
      const slowStartupMs = 80
      const fakeGitExecutor = {
        isGitRepo: vi.fn(async (_cwd: string) => true),
        getStatus: vi.fn(async (cwd: string) => {
          if (cwd === startupPath) {
            await new Promise((resolve) => setTimeout(resolve, slowStartupMs))
            return {
              branch: 'main',
              isDetached: false,
              upstream: null,
              entries: [],
            }
          }
          return {
            branch: 'feat/event-time-wins',
            isDetached: false,
            upstream: null,
            entries: [],
          }
        }),
      }

      const deps: OrchestratorDeps = {
        ...makeDeps(db, 'codex'),
        gitCommandExecutor: fakeGitExecutor as unknown as NonNullable<OrchestratorDeps['gitCommandExecutor']>,
        resolveProjectById: async (projectId: string) => ({
          id: projectId,
          canonicalPath: tmpDir,
        }),
      }

      const orchestrator = new SessionOrchestrator(deps)
      __setCodexSdkLoaderForTest(
        async () => ({ Codex: codexMocks.mockCodexCtor as unknown as typeof import('@openai/codex-sdk').Codex }),
      )
      codexMocks.state.turnPlans = [
        [
          { type: 'thread.started', thread_id: 'codex-thread-time-wins' },
          { type: 'turn.started' },
          { type: 'turn_context', payload: { cwd: runtimePath } },
          { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
          { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
        ],
      ]

      const sessionId = await orchestrator.startSession({
        prompt: 'event-time ordering',
        engineKind: 'codex',
        workspace: { scope: 'project', projectId: 'project-time-order' },
      })

      let session = await orchestrator.getSession(sessionId)
      for (let i = 0; i < 40 && session?.executionContext?.gitBranch !== 'feat/event-time-wins'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        session = await orchestrator.getSession(sessionId)
      }
      expect(session?.executionContext?.cwd).toBe(runtimePath)
      expect(session?.executionContext?.gitBranch).toBe('feat/event-time-wins')

      await new Promise((resolve) => setTimeout(resolve, slowStartupMs + 60))
      const after = await orchestrator.getSession(sessionId)
      expect(after?.executionContext?.cwd).toBe(runtimePath)
      expect(after?.executionContext?.gitBranch).toBe('feat/event-time-wins')

      await orchestrator.stopSession(sessionId)
      await orchestrator.shutdown()
      __resetCodexSdkLoaderForTest()
    } finally {
      await close()
      await rm(tmpDir, { recursive: true, force: true })
    }
  })
})
