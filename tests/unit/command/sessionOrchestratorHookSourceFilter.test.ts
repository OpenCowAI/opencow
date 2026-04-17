// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { SessionOrchestrator, type OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'
import type { SessionSnapshot } from '../../../src/shared/types'

function makeDeps(): OrchestratorDeps {
  return {
    dispatch: () => undefined,
    getProxyEnv: () => ({}),
    getProviderEnv: async () => ({}),
    getProviderDefaultModel: () => undefined,
    getCommandDefaults: () => ({
      maxTurns: 10,
      permissionMode: 'default',
    }),
    store: {} as never,
  }
}

function makeSnapshot(overrides: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    id: 'ccb-1',
    engineSessionRef: null,
    engineState: null,
    state: 'creating',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
    model: 'test-model',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    activeDurationMs: 0,
    activeStartedAt: Date.now(),
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    contextLimitOverride: null,
    contextTelemetry: null,
    activity: null,
    error: null,
    executionContext: null,
    ...overrides,
  }
}

interface MockRuntime {
  session: {
    getEngineRef: () => string | null
    origin: { source: string; [key: string]: unknown }
    getState: () => string
    snapshot: () => SessionSnapshot
  }
  executionContextSignalHandler?: (signal: unknown) => void
}

function setActiveSessions(orchestrator: SessionOrchestrator, snapshots: SessionSnapshot[]): void {
  const runtimes = new Map<string, MockRuntime>()
  for (const snap of snapshots) {
    runtimes.set(snap.id, {
      session: {
        getEngineRef: () => snap.engineSessionRef,
        origin: snap.origin,
        getState: () => snap.state,
        snapshot: () => snap,
      },
    })
  }
  ;(orchestrator as unknown as { runtimes: typeof runtimes }).runtimes = runtimes
}

describe('SessionOrchestrator hook-source skip policy', () => {
  it('skips hook-source events for Claude managed sessions', () => {
    const orchestrator = new SessionOrchestrator(makeDeps())
    setActiveSessions(orchestrator, [
      makeSnapshot({
        id: 'ccb-claude',
        engineSessionRef: 'claude-engine-ref',
      }),
    ])

    expect(orchestrator.isManagedSession('ccb-claude')).toBe(true)
    expect(orchestrator.isManagedSession('claude-engine-ref')).toBe(true)

    expect(orchestrator.shouldSkipHookSourceEvent('ccb-claude')).toBe(true)
    expect(orchestrator.shouldSkipHookSourceEvent('claude-engine-ref')).toBe(true)
  })

  it('returns false for unknown session refs', () => {
    const orchestrator = new SessionOrchestrator(makeDeps())
    expect(orchestrator.isManagedSession('missing')).toBe(false)
    expect(orchestrator.shouldSkipHookSourceEvent('missing')).toBe(false)
  })

  it('ingests external execution-context signal for managed sessions with runtime handler', () => {
    const orchestrator = new SessionOrchestrator(makeDeps())
    const claudeSignalHandler = vi.fn()
    const runtimes = new Map<string, MockRuntime>()
    runtimes.set('ccb-claude', {
      session: {
        getEngineRef: () => 'claude-engine-ref',
        origin: { source: 'agent' },
        getState: () => 'streaming',
        snapshot: () => makeSnapshot({ id: 'ccb-claude', engineSessionRef: 'claude-engine-ref' }),
      },
      executionContextSignalHandler: claudeSignalHandler,
    })
    ;(orchestrator as unknown as { runtimes: typeof runtimes }).runtimes = runtimes

    orchestrator.ingestExecutionContextSignal('claude-engine-ref', {
      cwd: '/tmp/claude-hook-cwd',
      source: 'hook',
      occurredAtMs: 1_733_000_000_100,
    })
    orchestrator.ingestExecutionContextSignal('missing', {
      cwd: '/tmp/missing',
      source: 'hook',
      occurredAtMs: 1_733_000_000_200,
    })

    expect(claudeSignalHandler).toHaveBeenCalledTimes(1)
    expect(claudeSignalHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/claude-hook-cwd',
        source: 'hook',
        occurredAtMs: 1_733_000_000_100,
      }),
    )
  })
})
