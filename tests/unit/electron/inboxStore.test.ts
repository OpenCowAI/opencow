// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Kysely } from 'kysely'
import { createTestDb } from '../../helpers/testDb'
import { InboxStore } from '../../../electron/services/inboxStore'
import type {
  HookEventMessage,
  SmartReminderMessage,
  InboxMessage
} from '../../../src/shared/types'
import type { Database } from '../../../electron/database/types'

// === Factory helpers ===

function makeHookEvent(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
  return {
    id: `hook-${Math.random().toString(36).slice(2, 8)}`,
    category: 'hook_event',
    eventType: 'task_completed',
    status: 'unread',
    createdAt: Date.now(),
    projectId: 'proj-1',
    sessionId: 'sess-1',
    navigationTarget: {
      kind: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    },
    rawPayload: {},
    ...overrides
  }
}

function makeReminder(overrides: Partial<SmartReminderMessage> = {}): SmartReminderMessage {
  return {
    id: `reminder-${Math.random().toString(36).slice(2, 8)}`,
    category: 'smart_reminder',
    reminderType: 'idle_session',
    status: 'unread',
    createdAt: Date.now(),
    context: {
      sessionId: 'sess-1',
      idleDurationMs: 7200000,
      lastActivity: Date.now() - 7200000
    },
    ...overrides
  }
}

let db: Kysely<Database>
let close: () => Promise<void>
let store: InboxStore

beforeEach(async () => {
  ({ db, close } = await createTestDb())
  store = new InboxStore(db)
})

afterEach(async () => {
  await close()
})

describe('InboxStore', () => {
  describe('load()', () => {
    it('returns empty array when database is fresh', async () => {
      const result = await store.load()
      expect(result).toEqual([])
    })

    it('returns previously added messages', async () => {
      const msg1 = makeHookEvent({ id: 'msg-1', createdAt: 1000 })
      const msg2 = makeReminder({ id: 'msg-2', createdAt: 2000 })
      await store.add(msg1)
      await store.add(msg2)

      const result = await store.load()
      expect(result).toHaveLength(2)
      expect(result.find(m => m.id === 'msg-1')).toBeDefined()
      expect(result.find(m => m.id === 'msg-2')).toBeDefined()
    })
  })

  describe('add()', () => {
    it('adds a message and it appears in list', async () => {
      const msg = makeHookEvent({ id: 'add-1' })
      await store.add(msg)

      const listed = await store.list()
      expect(listed).toHaveLength(1)
      expect(listed[0].id).toBe('add-1')
    })
  })

  describe('update()', () => {
    it('updates message status and sets readAt when marking as read', async () => {
      const msg = makeHookEvent({ id: 'upd-1', status: 'unread' })
      await store.add(msg)

      const updated = await store.update('upd-1', 'read')

      expect(updated.status).toBe('read')
      expect(updated.readAt).toBeTypeOf('number')
      expect(updated.readAt).toBeGreaterThan(0)
    })

    it('updates message status and sets archivedAt when archiving', async () => {
      const msg = makeHookEvent({ id: 'upd-2', status: 'unread' })
      await store.add(msg)

      const updated = await store.update('upd-2', 'archived')

      expect(updated.status).toBe('archived')
      expect(updated.archivedAt).toBeTypeOf('number')
      expect(updated.archivedAt).toBeGreaterThan(0)
    })

    it('persists updated state to database', async () => {
      const msg = makeHookEvent({ id: 'upd-3', status: 'unread' })
      await store.add(msg)

      await store.update('upd-3', 'read')

      // Verify via a second store instance
      const store2 = new InboxStore(db)
      const msgs = await store2.list()
      expect(msgs).toHaveLength(1)
      expect(msgs[0].status).toBe('read')
    })

    it('throws if message not found', async () => {
      await expect(store.update('nonexistent', 'read')).rejects.toThrow('Message not found: nonexistent')
    })
  })

  describe('dismiss()', () => {
    it('removes message from database and returns true', async () => {
      const msg1 = makeHookEvent({ id: 'dis-1' })
      const msg2 = makeHookEvent({ id: 'dis-2' })
      await store.add(msg1)
      await store.add(msg2)

      const result = await store.dismiss('dis-1')

      expect(result).toBe(true)
      const listed = await store.list()
      expect(listed).toHaveLength(1)
      expect(listed[0].id).toBe('dis-2')
    })

    it('returns false if message not found', async () => {
      const result = await store.dismiss('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('markAllRead()', () => {
    it('marks all unread as read and returns count of changed messages', async () => {
      await store.add(makeHookEvent({ id: 'mar-1', status: 'unread' }))
      await store.add(makeHookEvent({ id: 'mar-2', status: 'unread' }))
      await store.add(makeHookEvent({ id: 'mar-3', status: 'read' }))

      const count = await store.markAllRead()

      expect(count).toBe(2)
      const msgs = await store.list()
      expect(msgs.every(m => m.status === 'read')).toBe(true)
    })

    it('returns 0 when no unread messages exist', async () => {
      await store.add(makeHookEvent({ id: 'mar-4', status: 'read' }))

      const count = await store.markAllRead()
      expect(count).toBe(0)
    })
  })

  describe('list()', () => {
    it('with no filter returns all messages sorted by createdAt desc', async () => {
      await store.add(makeHookEvent({ id: 'list-1', createdAt: 1000 }))
      await store.add(makeHookEvent({ id: 'list-2', createdAt: 3000 }))
      await store.add(makeHookEvent({ id: 'list-3', createdAt: 2000 }))

      const msgs = await store.list()

      expect(msgs).toHaveLength(3)
      expect(msgs[0].id).toBe('list-2')
      expect(msgs[1].id).toBe('list-3')
      expect(msgs[2].id).toBe('list-1')
    })

    it('with category filter returns only hook events', async () => {
      await store.add(makeHookEvent({ id: 'cat-1' }))
      await store.add(makeReminder({ id: 'cat-2' }))
      await store.add(makeHookEvent({ id: 'cat-3' }))

      const msgs = await store.list({ category: 'hook_event' })

      expect(msgs).toHaveLength(2)
      expect(msgs.every(m => m.category === 'hook_event')).toBe(true)
    })

    it('with status filter returns only unread', async () => {
      await store.add(makeHookEvent({ id: 'st-1', status: 'unread' }))
      await store.add(makeHookEvent({ id: 'st-2', status: 'read' }))
      await store.add(makeHookEvent({ id: 'st-3', status: 'unread' }))

      const msgs = await store.list({ status: 'unread' })

      expect(msgs).toHaveLength(2)
      expect(msgs.every(m => m.status === 'unread')).toBe(true)
    })

    it('with search filter matches against formatted title/body', async () => {
      await store.add(makeHookEvent({
        id: 'srch-1',
        eventType: 'session_error',
        rawPayload: { error: 'TypeError: Cannot read property' }
      }))
      await store.add(makeHookEvent({
        id: 'srch-2',
        eventType: 'task_completed',
        rawPayload: {}
      }))

      const msgs = await store.list({ search: 'error' })

      // 'Session Error' title matches 'error', and the body also has 'error'
      expect(msgs.length).toBeGreaterThanOrEqual(1)
      expect(msgs.find(m => m.id === 'srch-1')).toBeDefined()
    })

    it('with projectId filter returns only messages for that project', async () => {
      await store.add(makeHookEvent({ id: 'proj-1', projectId: 'proj-A' }))
      await store.add(makeHookEvent({ id: 'proj-2', projectId: 'proj-B' }))
      await store.add(makeReminder({
        id: 'proj-3',
        reminderType: 'error_spike',
        context: { projectId: 'proj-A', errorCount: 3, windowMs: 600000 }
      }))
      await store.add(makeReminder({
        id: 'proj-4',
        reminderType: 'idle_session',
        context: { sessionId: 'sess-1', idleDurationMs: 60000, lastActivity: Date.now() }
      }))

      const msgs = await store.list({ projectId: 'proj-A' })

      // Only hook_event with project_id = 'proj-A' is indexed.
      // Smart reminders don't have project_id in the denormalized column,
      // so they won't match (different from the old in-memory store).
      expect(msgs).toHaveLength(1)
      expect(msgs[0].id).toBe('proj-1')
    })
  })

  describe('getStats()', () => {
    it('returns unreadCount and total', async () => {
      await store.add(makeHookEvent({ id: 'stats-1', status: 'unread' }))
      await store.add(makeHookEvent({ id: 'stats-2', status: 'read' }))
      await store.add(makeHookEvent({ id: 'stats-3', status: 'unread' }))

      const stats = await store.getStats()

      expect(stats).toEqual({ unreadCount: 2, total: 3 })
    })

    it('returns zeros when empty', async () => {
      const stats = await store.getStats()
      expect(stats).toEqual({ unreadCount: 0, total: 0 })
    })
  })

  describe('compact()', () => {
    it('removes archived messages older than 7 days', async () => {
      const EIGHT_DAYS_AGO = Date.now() - 8 * 24 * 60 * 60 * 1000
      const TWO_DAYS_AGO = Date.now() - 2 * 24 * 60 * 60 * 1000

      await store.add(makeHookEvent({
        id: 'cmp-1',
        status: 'archived',
        archivedAt: EIGHT_DAYS_AGO,
        createdAt: EIGHT_DAYS_AGO
      }))
      await store.add(makeHookEvent({
        id: 'cmp-2',
        status: 'archived',
        archivedAt: TWO_DAYS_AGO,
        createdAt: TWO_DAYS_AGO
      }))
      await store.add(makeHookEvent({
        id: 'cmp-3',
        status: 'unread',
        createdAt: Date.now()
      }))

      await store.compact()

      const msgs = await store.list()
      expect(msgs).toHaveLength(2)
      const ids = msgs.map(m => m.id).sort()
      expect(ids).toEqual(['cmp-2', 'cmp-3'])
    })

    it('trims to 1000 messages when over limit, removing oldest read messages first', async () => {
      // Add 1002 messages: 500 unread + 502 read (oldest first)
      const messages: InboxMessage[] = []
      for (let i = 0; i < 502; i++) {
        messages.push(makeHookEvent({
          id: `read-${i.toString().padStart(4, '0')}`,
          status: 'read',
          createdAt: 1000 + i // oldest first
        }))
      }
      for (let i = 0; i < 500; i++) {
        messages.push(makeHookEvent({
          id: `unread-${i.toString().padStart(4, '0')}`,
          status: 'unread',
          createdAt: 2000 + i
        }))
      }

      for (const msg of messages) {
        await store.add(msg)
      }

      expect(await store.list()).toHaveLength(1002)

      await store.compact()

      const result = await store.list()
      expect(result).toHaveLength(1000)

      // The 2 oldest read messages should have been removed
      const ids = result.map(m => m.id)
      expect(ids).not.toContain('read-0000')
      expect(ids).not.toContain('read-0001')
      // The rest should remain
      expect(ids).toContain('read-0002')
      // All unread should still be present
      for (let i = 0; i < 500; i++) {
        expect(ids).toContain(`unread-${i.toString().padStart(4, '0')}`)
      }
    })
  })
})
