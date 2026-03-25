// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'crypto'
import type { EngineEventEnvelope } from '@shared/types'

export interface EngineEventMessageIdentityInput {
  canonicalSessionId: string
  event: EngineEventEnvelope
}

export interface EngineEventMessageIdentity {
  dedupKey: string
  messageId: string
}

/**
 * Build a deterministic inbox identity for a normalized engine event.
 *
 * Guarantees:
 * - Same normalized event occurrence resolves to the same key (idempotent replay safe).
 * - Different occurrences in the same session resolve to different keys.
 */
export function buildEngineEventMessageIdentity(
  input: EngineEventMessageIdentityInput,
): EngineEventMessageIdentity {
  // Dedup by canonical session + event occurrence identity.
  // This preserves repeated semantic events (e.g. multiple completions) while
  // still collapsing exact replays of the same normalized event envelope.
  const dedupKey = `${input.canonicalSessionId}|${input.event.eventId}`
  const messageId = `evt_${sha256Hex(dedupKey).slice(0, 24)}`
  return { dedupKey, messageId }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
