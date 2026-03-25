// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { SessionOrchestrator, type OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'
import type { SessionSnapshot } from '../../../src/shared/types'

function makeDeps(): OrchestratorDeps {
  return {
    dispatch: () => undefined,
    getProxyEnv: () => ({}),
    getProviderEnv: async () => ({}),
    getCodexAuthConfig: async () => null,
    getProviderDefaultModel: () => undefined,
    getProviderDefaultReasoningEffort: () => undefined,
    getCommandDefaults: () => ({
      maxTurns: 10,
      permissionMode: 'default',
      defaultEngine: 'claude',
    }),
    store: {} as never,
  }
}

function makeSnapshot(overrides: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    id: 'ccb-1',
    engineKind: 'claude',
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
    getEngineKind: () => string
    origin: { source: string; [key: string]: unknown }
    getState: () => string
    snapshot: () => SessionSnapshot
  }
}

function setActiveSessions(orchestrator: SessionOrchestrator, snapshots: SessionSnapshot[]): void {
  const runtimes = new Map<string, MockRuntime>()
  for (const snap of snapshots) {
    runtimes.set(snap.id, {
      session: {
        getEngineRef: () => snap.engineSessionRef,
        getEngineKind: () => snap.engineKind,
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
        engineKind: 'claude',
        engineSessionRef: 'claude-engine-ref',
      }),
    ])

    expect(orchestrator.isManagedSession('ccb-claude')).toBe(true)
    expect(orchestrator.isManagedSession('claude-engine-ref')).toBe(true)

    expect(orchestrator.shouldSkipHookSourceEvent('ccb-claude')).toBe(true)
    expect(orchestrator.shouldSkipHookSourceEvent('claude-engine-ref')).toBe(true)
  })

  it('does not skip hook-source events for Codex managed sessions', () => {
    const orchestrator = new SessionOrchestrator(makeDeps())
    setActiveSessions(orchestrator, [
      makeSnapshot({
        id: 'ccb-codex',
        engineKind: 'codex',
        engineSessionRef: 'codex-engine-ref',
      }),
    ])

    expect(orchestrator.isManagedSession('ccb-codex')).toBe(true)
    expect(orchestrator.isManagedSession('codex-engine-ref')).toBe(true)

    expect(orchestrator.shouldSkipHookSourceEvent('ccb-codex')).toBe(false)
    expect(orchestrator.shouldSkipHookSourceEvent('codex-engine-ref')).toBe(false)
  })

  it('returns false for unknown session refs', () => {
    const orchestrator = new SessionOrchestrator(makeDeps())
    expect(orchestrator.isManagedSession('missing')).toBe(false)
    expect(orchestrator.shouldSkipHookSourceEvent('missing')).toBe(false)
  })
})
