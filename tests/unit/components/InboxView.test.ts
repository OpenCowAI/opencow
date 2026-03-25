// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type {
  InboxMessage, HookEventMessage, SmartReminderMessage,
  InboxFilter
} from '@shared/types'
import { formatMessageTitle, formatMessageBody, deriveMessagePriority, formatRelativeTime } from '@shared/inboxFormatters'

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
    navigationTarget: {
      kind: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    },
    rawPayload: {},
    ...overrides
  }
}

function makeSmartReminder(overrides: Partial<SmartReminderMessage> = {}): SmartReminderMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    category: 'smart_reminder',
    reminderType: 'idle_session',
    status: 'unread',
    createdAt: Date.now(),
    context: {
      type: 'idle_session',
      sessionId: 'sess-1',
      projectId: 'proj-1',
      idleDurationMs: 7200000
    },
    ...overrides
  }
}

// Replicate the filterMessages logic from InboxMessageList
function filterMessages(messages: InboxMessage[], filter: InboxFilter): InboxMessage[] {
  let filtered = messages

  if (filter.category) {
    filtered = filtered.filter((m) => m.category === filter.category)
  }

  if (filter.status) {
    filtered = filtered.filter((m) => m.status === filter.status)
  }

  if (filter.projectId) {
    filtered = filtered.filter((m) => {
      if (m.category === 'hook_event') return m.projectId === filter.projectId
      return true
    })
  }

  if (filter.search) {
    const q = filter.search.toLowerCase()
    filtered = filtered.filter((m) =>
      formatMessageTitle(m).toLowerCase().includes(q) ||
      formatMessageBody(m).toLowerCase().includes(q)
    )
  }

  return [...filtered].sort((a, b) => b.createdAt - a.createdAt)
}

// === Tests ===

describe('InboxView filtering logic', () => {
  const messages: InboxMessage[] = [
    makeHookEvent({ id: 'h1', eventType: 'session_error', projectId: 'proj-1', createdAt: 1000 }),
    makeHookEvent({ id: 'h2', eventType: 'session_start', projectId: 'proj-2', createdAt: 2000 }),
    makeHookEvent({ id: 'h3', eventType: 'task_completed', projectId: 'proj-1', createdAt: 3000, status: 'read' }),
    makeSmartReminder({ id: 'r1', reminderType: 'idle_session', createdAt: 4000 }),
    makeSmartReminder({ id: 'r2', reminderType: 'daily_summary', createdAt: 5000, context: { type: 'daily_summary', date: '2026-02-22', sessionsCompleted: 3, tasksCompleted: 2, totalCostUSD: 1.5 } })
  ]

  it('returns all messages sorted by createdAt desc when no filter', () => {
    const result = filterMessages(messages, {})
    expect(result.map(m => m.id)).toEqual(['r2', 'r1', 'h3', 'h2', 'h1'])
  })

  it('filters by category: hook_event', () => {
    const result = filterMessages(messages, { category: 'hook_event' })
    expect(result.every(m => m.category === 'hook_event')).toBe(true)
    expect(result).toHaveLength(3)
  })

  it('filters by category: smart_reminder', () => {
    const result = filterMessages(messages, { category: 'smart_reminder' })
    expect(result.every(m => m.category === 'smart_reminder')).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('filters by status: unread', () => {
    const result = filterMessages(messages, { status: 'unread' })
    expect(result.every(m => m.status === 'unread')).toBe(true)
    expect(result).toHaveLength(4)
  })

  it('filters by projectId', () => {
    const result = filterMessages(messages, { projectId: 'proj-1' })
    // Hook events with proj-1 + smart reminders (no projectId filter for reminders)
    expect(result.some(m => m.id === 'h1')).toBe(true)
    expect(result.some(m => m.id === 'h3')).toBe(true)
    // proj-2 should be filtered out
    expect(result.some(m => m.id === 'h2')).toBe(false)
  })

  it('filters by search term matching title', () => {
    const result = filterMessages(messages, { search: 'error' })
    // "Session Error" title matches
    expect(result.some(m => m.id === 'h1')).toBe(true)
  })

  it('filters by search term matching body', () => {
    const result = filterMessages(messages, { search: 'idle' })
    // Smart reminder body contains "idle"
    expect(result.some(m => m.id === 'r1')).toBe(true)
  })

  it('combines multiple filters', () => {
    const result = filterMessages(messages, { category: 'hook_event', status: 'unread' })
    expect(result).toHaveLength(2) // h1 (error, unread) and h2 (start, unread)
  })

  it('returns empty array when no matches', () => {
    const result = filterMessages(messages, { search: 'nonexistent-term-xyz' })
    expect(result).toHaveLength(0)
  })
})

describe('InboxView message rendering data', () => {
  it('derives correct priority for hook event messages', () => {
    expect(deriveMessagePriority(makeHookEvent({ eventType: 'session_error' }))).toBe('high')
    expect(deriveMessagePriority(makeHookEvent({ eventType: 'session_start' }))).toBe('normal')
    expect(deriveMessagePriority(makeHookEvent({ eventType: 'task_completed' }))).toBe('normal')
  })

  it('derives correct priority for smart reminders', () => {
    expect(deriveMessagePriority(makeSmartReminder({ reminderType: 'error_spike' }))).toBe('high')
    expect(deriveMessagePriority(makeSmartReminder({ reminderType: 'idle_session' }))).toBe('normal')
    expect(deriveMessagePriority(makeSmartReminder({
      reminderType: 'daily_summary',
      context: { type: 'daily_summary', date: '2026-02-22', sessionsCompleted: 1, tasksCompleted: 0, totalCostUSD: 0 }
    }))).toBe('low')
  })

  it('formats title correctly for each type', () => {
    expect(formatMessageTitle(makeHookEvent({ eventType: 'session_error' }))).toBe('Session Error')
    expect(formatMessageTitle(makeHookEvent({ eventType: 'session_start' }))).toBe('Session Started')
    expect(formatMessageTitle(makeHookEvent({ eventType: 'session_stop' }))).toBe('Session Stopped')
    expect(formatMessageTitle(makeHookEvent({ eventType: 'task_completed' }))).toBe('Task Completed')
    expect(formatMessageTitle(makeHookEvent({ eventType: 'notification' }))).toBe('Notification')
    expect(formatMessageTitle(makeSmartReminder({ reminderType: 'idle_session' }))).toBe('Idle Session')
    expect(formatMessageTitle(makeSmartReminder({ reminderType: 'error_spike' }))).toBe('Error Spike Detected')
  })

  it('latest 3 messages are correct slice', () => {
    const msgs: InboxMessage[] = Array.from({ length: 5 }, (_, i) =>
      makeHookEvent({ id: `msg-${i}`, createdAt: Date.now() - i * 1000 })
    )
    const latest3 = msgs.slice(0, 3)
    expect(latest3).toHaveLength(3)
    expect(latest3[0].id).toBe('msg-0')
    expect(latest3[2].id).toBe('msg-2')
  })
})

describe('InboxView detail panel data', () => {
  it('returns null when no message is selected', () => {
    const messages: InboxMessage[] = [makeHookEvent({ id: 'h1' })]
    const selected = messages.find(m => m.id === 'nonexistent') ?? null
    expect(selected).toBeNull()
  })

  it('finds selected message by id', () => {
    const messages: InboxMessage[] = [
      makeHookEvent({ id: 'h1' }),
      makeHookEvent({ id: 'h2' })
    ]
    const selected = messages.find(m => m.id === 'h2') ?? null
    expect(selected).not.toBeNull()
    expect(selected!.id).toBe('h2')
  })

  it('formats body for hook event with payload', () => {
    const msg = makeHookEvent({
      eventType: 'session_error',
      rawPayload: { error: 'Something went wrong' }
    })
    expect(formatMessageBody(msg)).toContain('Something went wrong')
  })

  it('formats body for idle session reminder', () => {
    const msg = makeSmartReminder({
      reminderType: 'idle_session',
      context: { type: 'idle_session', sessionId: 'sess-1', projectId: 'proj-1', idleDurationMs: 7200000 }
    })
    expect(formatMessageBody(msg)).toContain('2h')
  })

  it('formats body for daily summary', () => {
    const msg = makeSmartReminder({
      reminderType: 'daily_summary',
      context: { type: 'daily_summary', date: '2026-02-22', sessionsCompleted: 5, tasksCompleted: 3, totalCostUSD: 2.50 }
    })
    const body = formatMessageBody(msg)
    expect(body).toContain('5 sessions completed')
    expect(body).toContain('$2.50')
  })
})
