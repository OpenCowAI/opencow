// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, SessionSnapshot, SessionStopReason } from '../../src/shared/types'
import type { ManagedSession } from './managedSession'

type Dispatch = (event: DataBusEvent) => void

export interface DispatchSessionTerminalParams {
  readonly sessionId: string
  readonly session: ManagedSession
  readonly dispatch: Dispatch
  readonly terminalEvent: 'idle' | 'stopped' | 'error'
  readonly stopReason?: SessionStopReason
  readonly result?: string
  readonly error?: string
  readonly includeSessionUpdated?: boolean
}

export function dispatchSessionTerminal(params: DispatchSessionTerminalParams): SessionSnapshot {
  const snap = params.session.snapshot()

  if (params.includeSessionUpdated !== false) {
    params.dispatch({ type: 'command:session:updated', payload: snap })
  }

  if (params.terminalEvent === 'idle') {
    params.dispatch({
      type: 'command:session:idle',
      payload: {
        sessionId: params.sessionId,
        origin: params.session.origin,
        stopReason: params.stopReason ?? snap.stopReason ?? 'completed',
        result: params.result,
        costUsd: snap.totalCostUsd,
      },
    })
    return snap
  }

  if (params.terminalEvent === 'stopped') {
    params.dispatch({
      type: 'command:session:stopped',
      payload: {
        sessionId: params.sessionId,
        origin: params.session.origin,
        stopReason: params.stopReason ?? snap.stopReason ?? 'user_stopped',
        result: params.result,
        costUsd: snap.totalCostUsd,
      },
    })
    return snap
  }

  params.dispatch({
    type: 'command:session:error',
    payload: {
      sessionId: params.sessionId,
      origin: params.session.origin,
      error: params.error ?? snap.error ?? 'Session failed',
    },
  })
  return snap
}
