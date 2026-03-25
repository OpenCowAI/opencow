// SPDX-License-Identifier: Apache-2.0

import type { EngineRuntimeEventEnvelope } from '../runtime/events'

export type ConversationDomainEventEnvelope = EngineRuntimeEventEnvelope

export function toConversationDomainEventEnvelope(
  runtimeEvent: EngineRuntimeEventEnvelope,
): ConversationDomainEventEnvelope {
  return runtimeEvent
}
