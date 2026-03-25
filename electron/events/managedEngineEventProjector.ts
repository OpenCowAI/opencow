// SPDX-License-Identifier: Apache-2.0

import type {
  DataBusEvent,
  EngineEventEnvelope,
  SessionSnapshot,
  SessionStatus,
} from '@shared/types'
import {
  mapCommandSessionErrorToEngineEvent,
  mapCommandSessionIdleToEngineEvent,
  mapCommandSessionStoppedToEngineEvent,
  mapManagedSessionInfoToSessionStartEngineEvent,
} from './engineEventMapper'
import { mapManagedSessionStateToStatus } from './sessionStatusMapper'

const DEFAULT_MAX_ENTRIES = 2_000
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1_000 // 24h

interface ManagedStatusSnapshot {
  status: SessionStatus
  seenAt: number
}

export interface ManagedEngineEventProjectorOptions {
  now?: () => number
  maxEntries?: number
  staleMs?: number
}

/**
 * Projects managed-session command events into normalized EngineEvent envelopes.
 *
 * Responsibilities:
 * - Emit `session_start` when a managed session enters active execution.
 * - Emit `session_stop` / `session_error` for managed terminal command events.
 * - Keep minimal status memory to avoid repeated start emissions while already active.
 */
export class ManagedEngineEventProjector {
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly staleMs: number
  private statusBySession = new Map<string, ManagedStatusSnapshot>()

  constructor(options: ManagedEngineEventProjectorOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS
  }

  project(event: DataBusEvent): EngineEventEnvelope[] {
    this.prune()

    switch (event.type) {
      case 'command:session:created':
      case 'command:session:updated':
        return this.projectFromManagedInfo(event.payload)

      case 'command:session:idle':
        this.setStatus(event.payload.sessionId, 'completed')
        return [mapCommandSessionIdleToEngineEvent(event)]

      case 'command:session:error':
        this.setStatus(event.payload.sessionId, 'error')
        return [mapCommandSessionErrorToEngineEvent(event)]

      case 'command:session:stopped': {
        const previous = this.getStatus(event.payload.sessionId)
        this.setStatus(event.payload.sessionId, 'completed')
        // If we already observed idle/completed, avoid emitting duplicate stop.
        if (previous === 'completed') return []
        return [mapCommandSessionStoppedToEngineEvent(event)]
      }

      case 'command:session:deleted':
        this.statusBySession.delete(event.payload.sessionId)
        return []

      default:
        return []
    }
  }

  private projectFromManagedInfo(info: SessionSnapshot): EngineEventEnvelope[] {
    const nextStatus = mapManagedSessionStateToStatus(info.state)
    const previousStatus = this.getStatus(info.id)
    this.setStatus(info.id, nextStatus)

    if (nextStatus === 'active' && previousStatus !== 'active') {
      return [mapManagedSessionInfoToSessionStartEngineEvent(info)]
    }
    return []
  }

  private getStatus(sessionId: string): SessionStatus | undefined {
    return this.statusBySession.get(sessionId)?.status
  }

  private setStatus(sessionId: string, status: SessionStatus): void {
    this.statusBySession.set(sessionId, {
      status,
      seenAt: this.now(),
    })
    this.prune()
  }

  private prune(): void {
    const now = this.now()
    const staleBefore = now - this.staleMs

    for (const [sessionId, snapshot] of this.statusBySession.entries()) {
      if (snapshot.seenAt < staleBefore) {
        this.statusBySession.delete(sessionId)
      }
    }

    if (this.statusBySession.size <= this.maxEntries) return

    const overflow = this.statusBySession.size - this.maxEntries
    const ordered = [...this.statusBySession.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)
    for (let i = 0; i < overflow; i++) {
      this.statusBySession.delete(ordered[i][0])
    }
  }
}
