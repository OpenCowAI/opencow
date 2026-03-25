// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  InboxMessageStatus,
  HookEventType,
  SmartReminderType,
  InboxPriority,
  InboxMessageBase,
  HookEventMessage,
  IdleSessionContext,
  ErrorSpikeContext,
  DailySummaryContext,
  SmartReminderContext,
  SmartReminderMessage,
  InboxMessage,
  InboxFilter,
  InboxStats,
  AppView
} from '../../../src/shared/types'

describe('Inbox types', () => {
  describe('HookEventMessage', () => {
    it('can be constructed with required fields', () => {
      const msg: HookEventMessage = {
        id: 'msg-1',
        status: 'unread',
        createdAt: Date.now(),
        category: 'hook_event',
        eventType: 'session_start',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        navigationTarget: { kind: 'session', projectId: 'proj-1', sessionId: 'sess-1' },
        rawPayload: { foo: 'bar' }
      }

      expect(msg.category).toBe('hook_event')
      expect(msg.eventType).toBe('session_start')
      expect(msg.id).toBe('msg-1')
      expect(msg.status).toBe('unread')
    })

    it('accepts optional readAt and archivedAt from base', () => {
      const msg: HookEventMessage = {
        id: 'msg-2',
        status: 'read',
        createdAt: Date.now(),
        readAt: Date.now(),
        archivedAt: undefined,
        category: 'hook_event',
        eventType: 'task_completed',
        projectId: 'proj-1',
        sessionId: 'sess-2',
        navigationTarget: { kind: 'session', projectId: 'proj-1', sessionId: 'sess-2' },
        rawPayload: {}
      }

      expectTypeOf(msg.readAt).toEqualTypeOf<number | undefined>()
      expectTypeOf(msg.archivedAt).toEqualTypeOf<number | undefined>()
    })

    it('accepts all HookEventType values', () => {
      const types: HookEventType[] = [
        'session_start',
        'session_stop',
        'session_error',
        'task_completed',
        'notification'
      ]
      expect(types).toHaveLength(5)
    })
  })

  describe('SmartReminderMessage', () => {
    it('can be constructed with idle_session context', () => {
      const ctx: IdleSessionContext = {
        sessionId: 'sess-idle',
        idleDurationMs: 60000,
        lastActivity: Date.now() - 60000
      }

      const msg: SmartReminderMessage = {
        id: 'msg-r1',
        status: 'unread',
        createdAt: Date.now(),
        category: 'smart_reminder',
        reminderType: 'idle_session',
        context: ctx
      }

      expect(msg.category).toBe('smart_reminder')
      expect(msg.reminderType).toBe('idle_session')
      expect(msg.context.sessionId).toBe('sess-idle')
    })

    it('can be constructed with error_spike context', () => {
      const ctx: ErrorSpikeContext = {
        projectId: 'proj-err',
        errorCount: 5,
        windowMs: 300000
      }

      const msg: SmartReminderMessage = {
        id: 'msg-r2',
        status: 'unread',
        createdAt: Date.now(),
        category: 'smart_reminder',
        reminderType: 'error_spike',
        context: ctx
      }

      expect(msg.category).toBe('smart_reminder')
      expect(msg.reminderType).toBe('error_spike')
      expect(msg.context.projectId).toBe('proj-err')
    })

    it('can be constructed with daily_summary context', () => {
      const ctx: DailySummaryContext = {
        date: '2026-02-22',
        sessionsCompleted: 3,
        tasksCompleted: 10,
        totalCostUSD: 1.5
      }

      const msg: SmartReminderMessage = {
        id: 'msg-r3',
        status: 'unread',
        createdAt: Date.now(),
        category: 'smart_reminder',
        reminderType: 'daily_summary',
        context: ctx
      }

      expect(msg.category).toBe('smart_reminder')
      expect(msg.reminderType).toBe('daily_summary')
    })
  })

  describe('InboxMessage discriminated union', () => {
    it('narrows by category to HookEventMessage', () => {
      const msg: InboxMessage = {
        id: 'msg-u1',
        status: 'unread',
        createdAt: Date.now(),
        category: 'hook_event',
        eventType: 'notification',
        projectId: 'proj-1',
        sessionId: 'sess-1',
        navigationTarget: { kind: 'session', projectId: 'proj-1', sessionId: 'sess-1' },
        rawPayload: {}
      }

      if (msg.category === 'hook_event') {
        // TypeScript should narrow to HookEventMessage here
        expectTypeOf(msg).toEqualTypeOf<HookEventMessage>()
        expect(msg.eventType).toBe('notification')
        expect(msg.sessionId).toBe('sess-1')
      }
    })

    it('narrows by category to SmartReminderMessage', () => {
      const msg: InboxMessage = {
        id: 'msg-u2',
        status: 'unread',
        createdAt: Date.now(),
        category: 'smart_reminder',
        reminderType: 'daily_summary',
        context: {
          date: '2026-02-22',
          sessionsCompleted: 1,
          tasksCompleted: 5,
          totalCostUSD: 0.75
        }
      }

      if (msg.category === 'smart_reminder') {
        expectTypeOf(msg).toEqualTypeOf<SmartReminderMessage>()
        expect(msg.reminderType).toBe('daily_summary')
      }
    })
  })

  describe('InboxFilter', () => {
    it('accepts empty filter (all optional)', () => {
      const filter: InboxFilter = {}
      expect(filter).toEqual({})
    })

    it('accepts partial filter with category only', () => {
      const filter: InboxFilter = { category: 'hook_event' }
      expect(filter.category).toBe('hook_event')
    })

    it('accepts partial filter with status only', () => {
      const filter: InboxFilter = { status: 'unread' }
      expect(filter.status).toBe('unread')
    })

    it('accepts full filter', () => {
      const filter: InboxFilter = {
        category: 'smart_reminder',
        status: 'read',
        search: 'idle',
        projectId: 'proj-1'
      }
      expect(filter.category).toBe('smart_reminder')
      expect(filter.search).toBe('idle')
    })
  })

  describe('InboxStats', () => {
    it('has correct shape', () => {
      const stats: InboxStats = {
        unreadCount: 5,
        total: 20
      }
      expectTypeOf(stats.unreadCount).toBeNumber()
      expectTypeOf(stats.total).toBeNumber()
    })
  })

  describe('InboxMessageStatus', () => {
    it('accepts valid status values', () => {
      const statuses: InboxMessageStatus[] = ['unread', 'read', 'archived']
      expect(statuses).toHaveLength(3)
    })
  })

  describe('InboxPriority', () => {
    it('accepts valid priority values', () => {
      const priorities: InboxPriority[] = ['high', 'normal', 'low']
      expect(priorities).toHaveLength(3)
    })
  })

  describe('AppView', () => {
    it('supports projects mode', () => {
      const view: AppView = {
        mode: 'projects',
        tab: 'dashboard',
        projectId: 'proj-1'
      }
      expect(view.mode).toBe('projects')
    })

    it('supports inbox mode', () => {
      const view: AppView = {
        mode: 'inbox',
        selectedMessageId: 'msg-1'
      }
      expect(view.mode).toBe('inbox')
    })

    it('supports inbox mode with null selected message', () => {
      const view: AppView = {
        mode: 'inbox',
        selectedMessageId: null
      }
      expect(view.selectedMessageId).toBeNull()
    })
  })
})
