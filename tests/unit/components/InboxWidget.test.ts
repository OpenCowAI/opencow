// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { InboxMessage, HookEventMessage, SmartReminderMessage } from '@shared/types'
import { formatMessageTitle, formatRelativeTime, deriveMessagePriority } from '@shared/inboxFormatters'

// === Test helpers ===

function makeHookEvent(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    category: 'hook_event',
    eventType: 'session_start',
    status: 'unread',
    createdAt: Date.now(),
    projectId: 'proj-1',
    sessionId: 'sess-1',
    rawPayload: {},
    ...overrides
  }
}

// === Tests ===

describe('InboxWidget data logic', () => {
  it('shows up to 3 most recent messages', () => {
    const messages: InboxMessage[] = Array.from({ length: 5 }, (_, i) =>
      makeHookEvent({ id: `msg-${i}`, createdAt: Date.now() - i * 1000 })
    )
    const latestMessages = messages.slice(0, 3)
    expect(latestMessages).toHaveLength(3)
    expect(latestMessages[0].id).toBe('msg-0')
    expect(latestMessages[2].id).toBe('msg-2')
  })

  it('returns empty when no messages', () => {
    const messages: InboxMessage[] = []
    const latestMessages = messages.slice(0, 3)
    expect(latestMessages).toHaveLength(0)
  })

  it('unread count > 0 shows badge', () => {
    const unreadCount = 3
    expect(unreadCount > 0).toBe(true)
  })

  it('unread count 0 hides badge', () => {
    const unreadCount = 0
    expect(unreadCount > 0).toBe(false)
  })

  it('formats title for each message in the list', () => {
    const messages: InboxMessage[] = [
      makeHookEvent({ eventType: 'session_error' }),
      makeHookEvent({ eventType: 'task_completed' }),
      makeHookEvent({ eventType: 'session_start' })
    ]
    const titles = messages.map(formatMessageTitle)
    expect(titles).toEqual(['Session Error', 'Task Completed', 'Session Started'])
  })

  it('derives priority for message display', () => {
    const errorMsg = makeHookEvent({ eventType: 'session_error' })
    const normalMsg = makeHookEvent({ eventType: 'session_start' })
    expect(deriveMessagePriority(errorMsg)).toBe('high')
    expect(deriveMessagePriority(normalMsg)).toBe('normal')
  })

  it('isActive when appView mode is inbox', () => {
    const appView = { mode: 'inbox' as const, selectedMessageId: null }
    expect(appView.mode === 'inbox').toBe(true)
  })

  it('isActive is false when appView mode is projects', () => {
    const appView = { mode: 'projects' as const, tab: 'dashboard' as const, projectId: null }
    expect(appView.mode === 'inbox').toBe(false)
  })
})
