// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { dispatchSessionTerminal } from '../../../electron/command/sessionTerminalDispatcher'
import type { DataBusEvent } from '../../../src/shared/types'

function makeSession(params?: {
  origin?: { source: 'agent' | 'issue' }
  stopReason?: 'completed' | 'user_stopped' | 'execution_error' | null
  totalCostUsd?: number
  error?: string | null
}) {
  return {
    origin: params?.origin ?? { source: 'agent' as const },
    snapshot: vi.fn(() => ({
      id: 'session-1',
      engineKind: 'claude',
      engineSessionRef: null,
      engineState: null,
      state: 'idle',
      stopReason: params?.stopReason ?? null,
      origin: params?.origin ?? { source: 'agent' as const },
      projectPath: null,
      projectId: null,
      model: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      activeDurationMs: 0,
      activeStartedAt: null,
      totalCostUsd: params?.totalCostUsd ?? 1.23,
      inputTokens: 0,
      outputTokens: 0,
      lastInputTokens: 0,
      contextLimitOverride: null,
      contextState: null,
      contextTelemetry: null,
      activity: null,
      error: params?.error ?? null,
      executionContext: null,
    })),
  }
}

describe('dispatchSessionTerminal', () => {
  it('dispatches updated + idle with fallback completed stop reason', () => {
    const dispatch = vi.fn<(event: DataBusEvent) => void>()
    const session = makeSession({ stopReason: null })

    dispatchSessionTerminal({
      sessionId: 'session-1',
      session: session as never,
      dispatch,
      terminalEvent: 'idle',
    })

    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'command:session:updated' }),
    )
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'command:session:idle',
        payload: expect.objectContaining({
          sessionId: 'session-1',
          stopReason: 'completed',
          costUsd: 1.23,
        }),
      }),
    )
  })

  it('dispatches stopped with explicit stop reason', () => {
    const dispatch = vi.fn<(event: DataBusEvent) => void>()
    const session = makeSession({ stopReason: 'completed' })

    dispatchSessionTerminal({
      sessionId: 'session-1',
      session: session as never,
      dispatch,
      terminalEvent: 'stopped',
      stopReason: 'user_stopped',
    })

    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'command:session:stopped',
        payload: expect.objectContaining({
          stopReason: 'user_stopped',
        }),
      }),
    )
  })

  it('dispatches error with explicit error message', () => {
    const dispatch = vi.fn<(event: DataBusEvent) => void>()
    const session = makeSession({ error: null })

    dispatchSessionTerminal({
      sessionId: 'session-1',
      session: session as never,
      dispatch,
      terminalEvent: 'error',
      error: 'boom',
    })

    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'command:session:error',
        payload: expect.objectContaining({
          error: 'boom',
        }),
      }),
    )
  })

  it('can skip command:session:updated dispatch when includeSessionUpdated=false', () => {
    const dispatch = vi.fn<(event: DataBusEvent) => void>()
    const session = makeSession({ stopReason: 'completed' })

    dispatchSessionTerminal({
      sessionId: 'session-1',
      session: session as never,
      dispatch,
      terminalEvent: 'idle',
      includeSessionUpdated: false,
    })

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command:session:idle' }),
    )
  })
})
