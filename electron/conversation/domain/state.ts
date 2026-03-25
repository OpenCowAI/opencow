// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionState } from '../../../src/shared/types'

export interface ConversationDomainState {
  phase: ManagedSessionState
  turnClosed: boolean
  activeTurnSeq: number | null
  closedTurnSeq: number | null
}

export function createInitialConversationDomainState(params: {
  phase: ManagedSessionState
}): ConversationDomainState {
  return {
    phase: params.phase,
    turnClosed: false,
    activeTurnSeq: null,
    closedTurnSeq: null,
  }
}
