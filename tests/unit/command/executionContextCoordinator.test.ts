// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type { SessionExecutionContext, SessionSnapshot, DataBusEvent } from '../../../src/shared/types'
import { ExecutionContextCoordinator } from '../../../electron/command/executionContextCoordinator'

function makeCtx(cwd: string, updatedAt: number): SessionExecutionContext {
  return {
    cwd,
    gitBranch: 'main',
    isDetached: false,
    isWorktree: false,
    updatedAt,
  }
}

function makeSnapshot(cwd: string): SessionSnapshot {
  return {
    id: 's1',
    engineKind: 'codex',
    engineSessionRef: null,
    engineState: null,
    state: 'idle',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
    model: null,
    createdAt: 0,
    lastActivity: 0,
    activeDurationMs: 0,
    activeStartedAt: null,
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    contextLimitOverride: null,
    contextState: null,
    contextTelemetry: null,
    activity: null,
    error: null,
    executionContext: makeCtx(cwd, 0),
  }
}

describe('ExecutionContextCoordinator', () => {
  it('ignores stale signal completion and keeps newer context', async () => {
    let current = makeCtx('/startup', 1)
    const updateExecutionContext = vi.fn((ctx: SessionExecutionContext) => {
      if (
        current.cwd === ctx.cwd &&
        current.gitBranch === ctx.gitBranch &&
        current.isDetached === ctx.isDetached &&
        current.isWorktree === ctx.isWorktree
      ) {
        return false
      }
      current = ctx
      return true
    })
    const dispatch = vi.fn((_event: DataBusEvent) => {})
    const persist = vi.fn(async () => {})

    const resolvers = new Map<string, (ctx: SessionExecutionContext) => void>()
    const resolveExecutionContext = vi.fn((cwd: string) => {
      return new Promise<SessionExecutionContext>((resolve) => {
        resolvers.set(cwd, resolve)
      })
    })

    const coordinator = new ExecutionContextCoordinator({
      sessionId: 's1',
      session: {
        updateExecutionContext,
        snapshot: () => makeSnapshot(current.cwd),
      },
      projectPath: null,
      gitExecutor: null,
      dispatch,
      persistSession: persist,
      resolveExecutionContext,
    })

    // Older signal
    coordinator.notify({
      cwd: '/older',
      source: 'codex.turn_context',
      occurredAtMs: 100,
    })
    // Newer signal
    coordinator.notify({
      cwd: '/newer',
      source: 'codex.turn_context',
      occurredAtMs: 200,
    })

    resolvers.get('/newer')?.(makeCtx('/newer', 200))
    await Promise.resolve()
    resolvers.get('/older')?.(makeCtx('/older', 100))
    await Promise.resolve()

    expect(current.cwd).toBe('/newer')
    expect(updateExecutionContext).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('uses arrival order when timestamps are equal', async () => {
    let current = makeCtx('/startup', 1)
    const updateExecutionContext = vi.fn((ctx: SessionExecutionContext) => {
      if (current.cwd === ctx.cwd) return false
      current = ctx
      return true
    })
    const dispatch = vi.fn((_event: DataBusEvent) => {})
    const persist = vi.fn(async () => {})

    const resolvers = new Map<string, (ctx: SessionExecutionContext) => void>()
    const resolveExecutionContext = vi.fn((cwd: string) => {
      return new Promise<SessionExecutionContext>((resolve) => {
        resolvers.set(cwd, resolve)
      })
    })

    const coordinator = new ExecutionContextCoordinator({
      sessionId: 's1',
      session: {
        updateExecutionContext,
        snapshot: () => makeSnapshot(current.cwd),
      },
      projectPath: null,
      gitExecutor: null,
      dispatch,
      persistSession: persist,
      resolveExecutionContext,
    })

    coordinator.notify({
      cwd: '/first',
      source: 'codex.turn_context',
      occurredAtMs: 100,
    })
    coordinator.notify({
      cwd: '/second',
      source: 'codex.turn_context',
      occurredAtMs: 100,
    })

    // Resolve second first; first later should still be stale due to tie-break seq.
    resolvers.get('/second')?.(makeCtx('/second', 100))
    await Promise.resolve()
    resolvers.get('/first')?.(makeCtx('/first', 100))
    await Promise.resolve()

    expect(current.cwd).toBe('/second')
    expect(updateExecutionContext).toHaveBeenCalledTimes(1)
  })
})
