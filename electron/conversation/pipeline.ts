// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionState } from '../../src/shared/types'
import type { SessionContext } from '../command/sessionContext'
import { toConversationDomainEventEnvelope } from './domain/events'
import { reduceConversationDomainEvent } from './domain/reducer'
import { createInitialConversationDomainState, type ConversationDomainState } from './domain/state'
import type { EngineRuntimeEventEnvelope } from './runtime/events'
import { applyConversationDomainEffects, type ProjectionApplyResult } from './projection/effectProjector'

export class ConversationEventPipeline {
  private state: ConversationDomainState

  constructor(params: { initialPhase: ManagedSessionState }) {
    this.state = createInitialConversationDomainState({
      phase: params.initialPhase,
    })
  }

  prepareForNextTurn(params?: { phase?: ManagedSessionState }): void {
    this.state = {
      ...this.state,
      phase: params?.phase ?? this.state.phase,
      turnClosed: false,
      activeTurnSeq: null,
      closedTurnSeq: null,
    }
  }

  applyRuntimeEvent(params: {
    runtimeEvent: EngineRuntimeEventEnvelope
    ctx: SessionContext
  }): ProjectionApplyResult {
    const domainEvent = toConversationDomainEventEnvelope(params.runtimeEvent)
    const decision = reduceConversationDomainEvent({
      state: this.state,
      eventEnvelope: domainEvent,
    })
    this.state = decision.state
    return applyConversationDomainEffects({
      effects: decision.effects,
      ctx: params.ctx,
    })
  }

  snapshot(): ConversationDomainState {
    return { ...this.state }
  }
}
