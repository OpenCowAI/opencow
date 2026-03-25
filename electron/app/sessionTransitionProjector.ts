// SPDX-License-Identifier: Apache-2.0

import type {
  DataBusEvent,
  SessionSnapshot,
  ManagedSessionState,
  SessionOrigin,
  SessionStatus,
  StatusTransition,
} from '../../src/shared/types'
import { mapManagedSessionStateToStatus } from '../events/sessionStatusMapper'

const DEFAULT_MAX_ENTRIES = 2_000
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1_000 // 24h

interface ManagedSnapshot {
  status: SessionStatus
  sessionName: string
  seenAt: number
}

export interface SessionTransitionProjectorOptions {
  now?: () => number
  maxEntries?: number
  staleMs?: number
}

/**
 * Projects managed-session lifecycle events into StatusTransition records.
 *
 * Responsibilities:
 * - Derive transitions from normalized command events (`command:session:*`)
 * - Keep managed-session identity for hook-transition dedup filtering
 * - Prune stale cache entries to prevent unbounded growth
 */
export class SessionTransitionProjector {
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly staleMs: number
  private readonly managed = new Map<string, ManagedSnapshot>()

  constructor(options: SessionTransitionProjectorOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS
  }

  projectFromCommandEvent(event: DataBusEvent): StatusTransition[] {
    switch (event.type) {
      case 'command:session:created':
      case 'command:session:updated':
        return this.trackManagedInfo(event.payload)
      case 'command:session:idle':
        return this.applyManagedStatus({
          sessionId: event.payload.sessionId,
          sessionName: this.fallbackSessionName(event.payload.sessionId),
          nextStatus: 'completed',
        })
      case 'command:session:stopped':
        return this.applyManagedStatus({
          sessionId: event.payload.sessionId,
          sessionName: this.fallbackSessionName(event.payload.sessionId),
          nextStatus: 'completed',
        })
      case 'command:session:error':
        return this.applyManagedStatus({
          sessionId: event.payload.sessionId,
          sessionName: this.fallbackSessionName(event.payload.sessionId),
          nextStatus: 'error',
        })
      case 'command:session:deleted':
        this.managed.delete(event.payload.sessionId)
        return []
      default:
        return []
    }
  }

  /**
   * Hook transitions are accepted only for sessions not tracked as managed.
   */
  projectFromHookTransition(transition: StatusTransition): StatusTransition[] {
    this.prune()
    return this.managed.has(transition.sessionId) ? [] : [transition]
  }

  private trackManagedInfo(info: SessionSnapshot): StatusTransition[] {
    const sessionName = managedSessionName(info)
    const nextStatus = toTransitionStatus(info.state)
    return this.applyManagedStatus({ sessionId: info.id, sessionName, nextStatus })
  }

  private applyManagedStatus(params: {
    sessionId: string
    sessionName: string
    nextStatus: SessionStatus
  }): StatusTransition[] {
    const now = this.now()
    const previous = this.managed.get(params.sessionId)
    const nextSnapshot: ManagedSnapshot = {
      status: params.nextStatus,
      sessionName: params.sessionName,
      seenAt: now,
    }
    this.managed.set(params.sessionId, nextSnapshot)
    this.prune()

    if (!previous || previous.status === params.nextStatus) return []

    return [
      {
        sessionId: params.sessionId,
        sessionName: previous.sessionName || params.sessionName,
        previousStatus: previous.status,
        newStatus: params.nextStatus,
        timestamp: now,
      },
    ]
  }

  private fallbackSessionName(sessionId: string): string {
    return this.managed.get(sessionId)?.sessionName ?? `Session ${sessionId}`
  }

  private prune(): void {
    const now = this.now()
    const staleBefore = now - this.staleMs

    for (const [sessionId, snapshot] of this.managed.entries()) {
      if (snapshot.seenAt < staleBefore) {
        this.managed.delete(sessionId)
      }
    }

    if (this.managed.size <= this.maxEntries) return

    // Remove oldest entries first.
    const overflow = this.managed.size - this.maxEntries
    const ordered = [...this.managed.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)
    for (let i = 0; i < overflow; i++) {
      this.managed.delete(ordered[i][0])
    }
  }
}

function managedSessionName(info: SessionSnapshot): string {
  return describeSessionOrigin(info.origin, info.id)
}

function describeSessionOrigin(origin: SessionOrigin, sessionId: string): string {
  switch (origin.source) {
    case 'issue':
      return `Issue ${origin.issueId}`
    case 'schedule':
      return `Schedule ${origin.scheduleId}`
    case 'hook':
      return `Webhook ${origin.webhookId}`
    case 'telegram':
      return `Telegram ${origin.chatId}`
    case 'feishu':
      return `Feishu ${origin.chatId}`
    case 'discord':
      return `Discord ${origin.channelId}`
    case 'weixin':
      return `WeChat ${origin.userId}`
    case 'review':
      return `Review ${origin.issueId}`
    case 'market-analyzer':
      return `Market ${origin.slug}`
    default:
      return `Session ${sessionId}`
  }
}

/**
 * Transition-level mapping used by notification/webhook consumers.
 *
 * Note: this may intentionally differ from UI runtime-state mapping.
 */
export function toTransitionStatus(state: ManagedSessionState): SessionStatus {
  return mapManagedSessionStateToStatus(state)
}
