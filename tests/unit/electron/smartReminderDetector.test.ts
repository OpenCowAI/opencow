// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, StatsSnapshot, InboxMessage, SmartReminderMessage } from '../../../src/shared/types'
import { SmartReminderDetector } from '../../../electron/services/smartReminderDetector'

// === Factory helpers ===

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Test Session',
    subtitle: null,
    status: 'active',
    cwd: '/home/user/project',
    gitBranch: 'main',
    lastActivity: Date.now() - 3 * 60 * 60 * 1000, // 3h ago (idle by default)
    startedAt: Date.now() - 4 * 60 * 60 * 1000,
    taskSummary: { total: 5, completed: 2, inProgress: 1, pending: 2 },
    ...overrides
  }
}

function makeStats(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    todayCostUSD: 1.5,
    todayTokens: 50000,
    todaySessions: 3,
    todayToolCalls: 42,
    totalSessions: 10,
    totalMessages: 200,
    ...overrides
  }
}

describe('SmartReminderDetector', () => {
  let detector: SmartReminderDetector

  beforeEach(() => {
    detector = new SmartReminderDetector()
    vi.restoreAllMocks()
  })

  // === Idle Session Detection ===

  describe('detectIdleSessions', () => {
    it('returns SmartReminderMessage[] for active sessions idle > 2h', () => {
      const sessions = [
        makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })
      ]
      const reminders = detector.detectIdleSessions(sessions)

      expect(reminders).toHaveLength(1)
      expect(reminders[0].category).toBe('smart_reminder')
      expect(reminders[0].reminderType).toBe('idle_session')
      expect(reminders[0].status).toBe('unread')
      expect(reminders[0].context).toMatchObject({
        sessionId: 'sess-1',
        idleDurationMs: expect.any(Number)
      })
      // idleDurationMs should be approximately 3 hours
      const ctx = reminders[0].context as { idleDurationMs: number }
      expect(ctx.idleDurationMs).toBeGreaterThan(2 * 60 * 60 * 1000)
    })

    it('returns empty for completed/waiting/error sessions even if idle > 2h', () => {
      const oldActivity = Date.now() - 5 * 60 * 60 * 1000 // 5h ago
      const sessions = [
        makeSession({ id: 's1', status: 'completed', lastActivity: oldActivity }),
        makeSession({ id: 's2', status: 'waiting', lastActivity: oldActivity }),
        makeSession({ id: 's3', status: 'error', lastActivity: oldActivity })
      ]
      const reminders = detector.detectIdleSessions(sessions)
      expect(reminders).toEqual([])
    })

    it('returns empty for active session with recent activity (< 2h)', () => {
      const sessions = [
        makeSession({ id: 'sess-1', status: 'active', lastActivity: Date.now() - 30 * 60 * 1000 }) // 30min ago
      ]
      const reminders = detector.detectIdleSessions(sessions)
      expect(reminders).toEqual([])
    })

    it('deduplicates: same session only triggers once', () => {
      const sessions = [
        makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })
      ]
      const first = detector.detectIdleSessions(sessions)
      expect(first).toHaveLength(1)

      const second = detector.detectIdleSessions(sessions)
      expect(second).toEqual([])
    })

    it('after onSessionActivity, the session can trigger again', () => {
      const sessions = [
        makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })
      ]
      // First detection
      const first = detector.detectIdleSessions(sessions)
      expect(first).toHaveLength(1)

      // Reset via activity
      detector.onSessionActivity('sess-1')

      // Can trigger again
      const third = detector.detectIdleSessions(sessions)
      expect(third).toHaveLength(1)
    })
  })

  // === Error Spike Detection ===

  describe('recordError / checkErrorSpike', () => {
    it('returns null when < 3 errors', () => {
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      const result = detector.checkErrorSpike('proj-1')
      expect(result).toBeNull()
    })

    it('returns SmartReminderMessage when >= 3 errors in 10min window', () => {
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      const result = detector.checkErrorSpike('proj-1')

      expect(result).not.toBeNull()
      expect(result!.category).toBe('smart_reminder')
      expect(result!.reminderType).toBe('error_spike')
      expect(result!.status).toBe('unread')
      expect(result!.context).toMatchObject({
        projectId: 'proj-1',
        errorCount: 3,
        windowMs: 600000
      })
    })

    it('old errors outside window are not counted', () => {
      vi.useFakeTimers()
      const baseTime = new Date('2026-02-22T12:00:00Z').getTime()

      // Record 2 errors at 15min and 14min ago (outside 10min window)
      vi.setSystemTime(baseTime - 15 * 60 * 1000)
      detector.recordError('proj-1')

      vi.setSystemTime(baseTime - 14 * 60 * 1000)
      detector.recordError('proj-1')

      // Record 1 error now (inside window)
      vi.setSystemTime(baseTime)
      detector.recordError('proj-1')

      const result = detector.checkErrorSpike('proj-1')
      // Only 1 recent error (within 10min), so no spike
      expect(result).toBeNull()

      vi.useRealTimers()
    })

    it('deduplicates: same project only triggers once per 10min window', () => {
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      detector.recordError('proj-1')

      const first = detector.checkErrorSpike('proj-1')
      expect(first).not.toBeNull()

      // Add more errors, still in same window
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      detector.recordError('proj-1')

      const second = detector.checkErrorSpike('proj-1')
      expect(second).toBeNull()
    })

    it('different projects tracked independently', () => {
      detector.recordError('proj-1')
      detector.recordError('proj-1')
      detector.recordError('proj-1')

      detector.recordError('proj-2')

      const result1 = detector.checkErrorSpike('proj-1')
      expect(result1).not.toBeNull()

      const result2 = detector.checkErrorSpike('proj-2')
      expect(result2).toBeNull()
    })
  })

  // === Daily Summary ===

  describe('checkDailySummary', () => {
    it('returns a reminder when lastDate is null (never generated)', () => {
      const stats = makeStats()
      const result = detector.checkDailySummary(null, stats)

      expect(result).not.toBeNull()
      expect(result!.category).toBe('smart_reminder')
      expect(result!.reminderType).toBe('daily_summary')
      expect(result!.status).toBe('unread')
      expect(result!.context).toMatchObject({
        sessionsCompleted: stats.todaySessions,
        totalCostUSD: stats.todayCostUSD
      })
    })

    it('returns reminder when lastDate < today', () => {
      const stats = makeStats()
      const result = detector.checkDailySummary('2026-02-20', stats)

      expect(result).not.toBeNull()
      expect(result!.reminderType).toBe('daily_summary')
    })

    it('returns null when lastDate === today', () => {
      const today = new Date().toISOString().slice(0, 10)
      const stats = makeStats()
      const result = detector.checkDailySummary(today, stats)

      expect(result).toBeNull()
    })

    it('returns null when stats is null', () => {
      const result = detector.checkDailySummary(null, null)
      expect(result).toBeNull()
    })
  })

  // === initializeFromMessages ===

  describe('initializeFromMessages', () => {
    it('populates idleNotified from existing idle_session reminders', () => {
      const existingMessages: InboxMessage[] = [
        {
          id: 'idle-1',
          category: 'smart_reminder',
          reminderType: 'idle_session',
          status: 'read',
          createdAt: Date.now() - 60000,
          context: { sessionId: 'sess-1', idleDurationMs: 7200000, lastActivity: Date.now() - 7200000 }
        }
      ]

      detector.initializeFromMessages(existingMessages)

      // Should NOT generate a new reminder for sess-1
      const sessions = [makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })]
      const reminders = detector.detectIdleSessions(sessions)
      expect(reminders).toHaveLength(0)
    })

    it('does not suppress idle reminders for archived messages', () => {
      const existingMessages: InboxMessage[] = [
        {
          id: 'idle-1',
          category: 'smart_reminder',
          reminderType: 'idle_session',
          status: 'archived',
          createdAt: Date.now() - 60000,
          archivedAt: Date.now() - 30000,
          context: { sessionId: 'sess-1', idleDurationMs: 7200000, lastActivity: Date.now() - 7200000 }
        }
      ]

      detector.initializeFromMessages(existingMessages)

      const sessions = [makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })]
      const reminders = detector.detectIdleSessions(sessions)
      expect(reminders).toHaveLength(1)
    })

    it('populates errorSpikeNotified from existing error_spike reminders', () => {
      const now = Date.now()
      const existingMessages: InboxMessage[] = [
        {
          id: 'spike-1',
          category: 'smart_reminder',
          reminderType: 'error_spike',
          status: 'read',
          createdAt: now - 60000, // 1 min ago, within 10min window
          context: { projectId: 'proj-1', errorCount: 3, windowMs: 600000 }
        }
      ]

      detector.initializeFromMessages(existingMessages)

      // Simulate enough errors to trigger spike check
      for (let i = 0; i < 3; i++) detector.recordError('proj-1')
      const spike = detector.checkErrorSpike('proj-1')
      expect(spike).toBeNull() // Should be suppressed
    })

    it('ignores non-smart_reminder messages', () => {
      const existingMessages: InboxMessage[] = [
        {
          id: 'hook-1',
          category: 'hook_event',
          eventType: 'session_start',
          status: 'unread',
          createdAt: Date.now(),
          projectId: 'proj-1',
          sessionId: 'sess-1',
          rawPayload: {}
        }
      ]

      // Should not throw
      detector.initializeFromMessages(existingMessages)

      // idle should still trigger for sess-1 (not suppressed by hook_event message)
      const sessions = [makeSession({ id: 'sess-1', lastActivity: Date.now() - 3 * 60 * 60 * 1000 })]
      const reminders = detector.detectIdleSessions(sessions)
      expect(reminders).toHaveLength(1)
    })
  })
})
