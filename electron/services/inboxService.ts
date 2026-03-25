// SPDX-License-Identifier: Apache-2.0

import { InboxStore } from './inboxStore'
import { MessageClassifier } from './messageClassifier'
import { SmartReminderDetector } from './smartReminderDetector'
import { allowsEngineEvent, type EventSubscriptionPolicy } from '../events/eventSubscriptionPolicy'
import type {
  DataBusEvent,
  AppStateMain,
  EngineEventEnvelope,
  InboxMessage,
  InboxMessageStatus,
  InboxFilter,
  InboxStats,
  InboxNavigationTarget,
  SessionSnapshot,
  IssueSummary,
} from '@shared/types'
import { getOriginIssueId } from '@shared/types'

interface InboxServiceParams {
  dispatch: (event: DataBusEvent) => void
  getState: () => AppStateMain
  store: InboxStore
  getEventSubscriptionPolicy: () => EventSubscriptionPolicy
  classifier?: MessageClassifier
  detector?: SmartReminderDetector
  resolveManagedSession?: (sessionRefs: string[]) => Promise<SessionSnapshot | null>
  resolveIssueBySessionRefs?: (sessionIds: string[]) => Promise<IssueSummary | null>
  resolveScheduleIdBySessionRefs?: (sessionIds: string[]) => Promise<string | null>
}

export class InboxService {
  private store: InboxStore
  private classifier: MessageClassifier
  private detector: SmartReminderDetector
  private dispatch: (event: DataBusEvent) => void
  private getState: () => AppStateMain
  private resolveManagedSession: (sessionRefs: string[]) => Promise<SessionSnapshot | null>
  private resolveIssueBySessionRefs: (sessionIds: string[]) => Promise<IssueSummary | null>
  private resolveScheduleIdBySessionRefs: (sessionIds: string[]) => Promise<string | null>
  private getEventSubscriptionPolicy: () => EventSubscriptionPolicy
  private idleScanTimer: ReturnType<typeof setInterval> | null = null

  constructor(params: InboxServiceParams) {
    this.store = params.store
    this.classifier = params.classifier ?? new MessageClassifier()
    this.detector = params.detector ?? new SmartReminderDetector()
    this.dispatch = params.dispatch
    this.getState = params.getState
    this.resolveManagedSession = params.resolveManagedSession ?? (async () => null)
    this.resolveIssueBySessionRefs = params.resolveIssueBySessionRefs ?? (async () => null)
    this.resolveScheduleIdBySessionRefs = params.resolveScheduleIdBySessionRefs ?? (async () => null)
    this.getEventSubscriptionPolicy = params.getEventSubscriptionPolicy
  }

  async start(): Promise<void> {
    const messages = await this.store.load()
    await this.store.compact()
    this.detector.initializeFromMessages(messages)
    await this.broadcastUpdate()
    this.startIdleScan()
  }

  stop(): void {
    if (this.idleScanTimer) {
      clearInterval(this.idleScanTimer)
      this.idleScanTimer = null
    }
  }

  async onEngineEvent(engineEvent: EngineEventEnvelope): Promise<void> {
    const state = this.getState()
    const managedSession = await this.resolveManagedSession([engineEvent.sessionRef])
    const sessionRefs = buildSessionRefs(engineEvent.sessionRef, managedSession)
    const canonicalSessionId = managedSession?.id ?? engineEvent.sessionRef
    const isKnownRuntimeSession =
      managedSession !== null ||
      state.sessions.some((s) => sessionRefs.includes(s.id))

    let projectId = managedSession?.projectId ?? null
    const [linkedIssue, linkedScheduleId] = await Promise.all([
      this.resolveIssueBySessionRefs(sessionRefs),
      this.resolveScheduleIdBySessionRefs(sessionRefs),
    ])
    const navigationTarget = this.resolveNavigationTarget({
      managedSession,
      linkedIssue,
      linkedScheduleId,
      fallbackProjectId: projectId,
      fallbackSessionId: canonicalSessionId,
    })

    if (!projectId && navigationTarget && navigationTarget.kind !== 'schedule') {
      projectId = navigationTarget.projectId
    }

    if (engineEvent.eventType === 'session_error' && projectId) {
      this.detector.recordError(projectId)
    }

    const subscriptionPolicy = this.getEventSubscriptionPolicy()
    if (!allowsEngineEvent(subscriptionPolicy, engineEvent)) {
      if (isKnownRuntimeSession) {
        this.detector.onSessionActivity(canonicalSessionId)
      }
      return
    }

    const message = this.classifier.classifyEngineEvent(engineEvent, {
      session: {
        canonicalId: canonicalSessionId,
        projectId,
        navigationTarget,
      },
    })
    if (message) {
      const inserted = await this.store.add(message)
      if (inserted) {
        await this.broadcastUpdate()
      }
    }

    if (engineEvent.eventType === 'session_error' && projectId) {
      const spike = this.detector.checkErrorSpike(projectId)
      if (spike) {
        const inserted = await this.store.add(spike)
        if (inserted) {
          await this.broadcastUpdate()
        }
      }
    }

    if (isKnownRuntimeSession || message) {
      this.detector.onSessionActivity(canonicalSessionId)
    }
  }

  async listMessages(filter?: InboxFilter): Promise<InboxMessage[]> {
    return this.store.list(filter)
  }

  async updateMessage(params: { id: string; status: InboxMessageStatus }): Promise<InboxMessage> {
    const updated = await this.store.update(params.id, params.status)
    await this.broadcastUpdate()
    return updated
  }

  async dismissMessage(id: string): Promise<boolean> {
    const result = await this.store.dismiss(id)
    if (result) await this.broadcastUpdate()
    return result
  }

  async markAllRead(): Promise<number> {
    const count = await this.store.markAllRead()
    if (count > 0) await this.broadcastUpdate()
    return count
  }

  async getStats(): Promise<InboxStats> {
    return this.store.getStats()
  }

  private startIdleScan(): void {
    this.idleScanTimer = setInterval(() => this.runIdleScan(), 60000)
  }

  private async runIdleScan(): Promise<void> {
    const state = this.getState()
    const reminders = this.detector.detectIdleSessions(state.sessions)
    let insertedAny = false
    for (const reminder of reminders) {
      const inserted = await this.store.add(reminder)
      insertedAny = insertedAny || inserted
    }
    if (insertedAny) await this.broadcastUpdate()
  }

  private async broadcastUpdate(): Promise<void> {
    const stats = await this.store.getStats()
    const messages = await this.store.list()
    this.dispatch({
      type: 'inbox:updated',
      payload: { messages, unreadCount: stats.unreadCount }
    })
  }

  private resolveNavigationTarget(input: {
    managedSession: SessionSnapshot | null
    linkedIssue: IssueSummary | null
    linkedScheduleId: string | null
    fallbackProjectId: string | null
    fallbackSessionId: string
  }): InboxNavigationTarget | null {
    const { managedSession, linkedIssue, linkedScheduleId, fallbackProjectId, fallbackSessionId } = input

    if (managedSession) {
      const issueId = getOriginIssueId(managedSession.origin)
      if (issueId && managedSession.projectId) {
        return { kind: 'issue', projectId: managedSession.projectId, issueId }
      }
      if (managedSession.origin.source === 'schedule') {
        return { kind: 'schedule', scheduleId: managedSession.origin.scheduleId }
      }
      if (managedSession.projectId) {
        return { kind: 'session', projectId: managedSession.projectId, sessionId: managedSession.id }
      }
    }

    if (linkedIssue?.projectId) {
      return { kind: 'issue', projectId: linkedIssue.projectId, issueId: linkedIssue.id }
    }

    if (linkedScheduleId) {
      return { kind: 'schedule', scheduleId: linkedScheduleId }
    }

    if (fallbackProjectId) {
      return { kind: 'session', projectId: fallbackProjectId, sessionId: fallbackSessionId }
    }

    return null
  }
}

function buildSessionRefs(sessionId: string, managedSession: SessionSnapshot | null): string[] {
  const refs = [
    sessionId,
    managedSession?.id ?? null,
    managedSession?.engineSessionRef ?? null,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  return [...new Set(refs)]
}
