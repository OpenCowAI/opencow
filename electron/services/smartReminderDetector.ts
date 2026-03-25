// SPDX-License-Identifier: Apache-2.0

import { generateId } from '../shared/identity'
import type {
  Session, SmartReminderMessage, StatsSnapshot,
  InboxMessage, IdleSessionContext, ErrorSpikeContext
} from '@shared/types'

const IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours
const ERROR_SPIKE_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const ERROR_SPIKE_THRESHOLD = 3

export class SmartReminderDetector {
  private idleNotified: Set<string> = new Set()
  private errorTimestamps: Map<string, number[]> = new Map()
  private errorSpikeNotified: Map<string, number> = new Map()

  initializeFromMessages(messages: InboxMessage[]): void {
    for (const msg of messages) {
      if (msg.category !== 'smart_reminder') continue
      if (msg.status === 'archived') continue

      if (msg.reminderType === 'idle_session') {
        const ctx = msg.context as IdleSessionContext
        this.idleNotified.add(ctx.sessionId)
      }

      if (msg.reminderType === 'error_spike') {
        const ctx = msg.context as ErrorSpikeContext
        const existing = this.errorSpikeNotified.get(ctx.projectId)
        if (!existing || msg.createdAt > existing) {
          this.errorSpikeNotified.set(ctx.projectId, msg.createdAt)
        }
      }
    }
  }

  detectIdleSessions(sessions: Session[]): SmartReminderMessage[] {
    const now = Date.now()
    const reminders: SmartReminderMessage[] = []

    for (const session of sessions) {
      if (session.status !== 'active') continue
      if (now - session.lastActivity <= IDLE_THRESHOLD_MS) continue
      if (this.idleNotified.has(session.id)) continue

      this.idleNotified.add(session.id)
      reminders.push({
        id: generateId(),
        category: 'smart_reminder',
        reminderType: 'idle_session',
        status: 'unread',
        createdAt: now,
        context: {
          sessionId: session.id,
          idleDurationMs: now - session.lastActivity,
          lastActivity: session.lastActivity
        }
      })
    }

    return reminders
  }

  onSessionActivity(sessionId: string): void {
    this.idleNotified.delete(sessionId)
  }

  recordError(projectId: string): void {
    const now = Date.now()
    const timestamps = this.errorTimestamps.get(projectId) ?? []
    timestamps.push(now)
    // Prune old entries outside the window
    const cutoff = now - ERROR_SPIKE_WINDOW_MS
    const recent = timestamps.filter(t => t > cutoff)
    this.errorTimestamps.set(projectId, recent)
  }

  checkErrorSpike(projectId: string): SmartReminderMessage | null {
    const now = Date.now()
    const timestamps = this.errorTimestamps.get(projectId) ?? []
    const cutoff = now - ERROR_SPIKE_WINDOW_MS
    const recent = timestamps.filter(t => t > cutoff)

    if (recent.length < ERROR_SPIKE_THRESHOLD) return null

    // Dedup: only trigger once per window
    const lastNotified = this.errorSpikeNotified.get(projectId)
    if (lastNotified !== undefined && now - lastNotified < ERROR_SPIKE_WINDOW_MS) return null
    this.errorSpikeNotified.set(projectId, now)

    return {
      id: generateId(),
      category: 'smart_reminder',
      reminderType: 'error_spike',
      status: 'unread',
      createdAt: now,
      context: {
        projectId,
        errorCount: recent.length,
        windowMs: ERROR_SPIKE_WINDOW_MS
      }
    }
  }

  checkDailySummary(
    lastSummaryDate: string | null,
    stats: StatsSnapshot | null
  ): SmartReminderMessage | null {
    if (!stats) return null
    const today = new Date().toISOString().slice(0, 10)
    if (lastSummaryDate === today) return null

    return {
      id: generateId(),
      category: 'smart_reminder',
      reminderType: 'daily_summary',
      status: 'unread',
      createdAt: Date.now(),
      context: {
        date: lastSummaryDate ?? 'first-run',
        sessionsCompleted: stats.todaySessions,
        tasksCompleted: 0,
        totalCostUSD: stats.todayCostUSD
      }
    }
  }
}
