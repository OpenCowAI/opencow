// SPDX-License-Identifier: Apache-2.0

import { generateId } from '../shared/identity'
import type { EngineEventEnvelope, HookEventMessage, InboxNavigationTarget } from '@shared/types'
import { buildEngineEventMessageIdentity } from '../events/engineEventIdentity'

export interface EngineEventClassificationContext {
  session: {
    canonicalId: string
    projectId: string | null
    navigationTarget: InboxNavigationTarget | null
  }
}

export class MessageClassifier {
  classifyEngineEvent(
    event: EngineEventEnvelope,
    context: EngineEventClassificationContext,
  ): HookEventMessage | null {
    const now = event.occurredAtMs || Date.now()
    const navigationTarget = context.session.navigationTarget
      ?? (context.session.projectId
        ? {
            kind: 'session',
            projectId: context.session.projectId,
            sessionId: context.session.canonicalId,
          } as const
        : null)

    if (!navigationTarget) return null

    const projectId = context.session.projectId
      ?? (navigationTarget.kind === 'schedule' ? null : navigationTarget.projectId)
    const identity = buildEngineEventMessageIdentity({
      canonicalSessionId: context.session.canonicalId,
      event,
    })

    return {
      id: identity.messageId || generateId(),
      category: 'hook_event',
      eventType: event.eventType,
      status: 'unread',
      createdAt: now,
      projectId,
      sessionId: context.session.canonicalId,
      navigationTarget,
      rawPayload: {
        ...event.payload,
        _engineEvent: {
          eventId: event.eventId,
          dedupKey: identity.dedupKey,
          source: event.source,
          sourceEventId: event.sourceEventId,
        },
      },
    }
  }

  pruneDedup(): void {
    // No-op: dedup is now deterministic via message identity + DB primary key conflict handling.
  }
}
