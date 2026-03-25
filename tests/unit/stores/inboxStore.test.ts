// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useInboxStore } from '../../../src/renderer/stores/inboxStore'
import type { HookEventMessage, InboxMessage } from '../../../src/shared/types'

function makeTestInboxMessage(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
  return {
    id: 'msg-1',
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

describe('inboxStore', () => {
  beforeEach(() => {
    useInboxStore.getState().reset()
  })

  it('initial state has empty inbox', () => {
    const state = useInboxStore.getState()
    expect(state.inboxMessages).toEqual([])
    expect(state.inboxUnreadCount).toBe(0)
    expect(state.inboxFilter).toEqual({})
  })

  it('setInboxMessages updates messages', () => {
    const messages: InboxMessage[] = [
      makeTestInboxMessage({ id: 'msg-1' }),
      makeTestInboxMessage({ id: 'msg-2', status: 'read' })
    ]
    useInboxStore.getState().setInboxMessages(messages)
    expect(useInboxStore.getState().inboxMessages).toEqual(messages)
    expect(useInboxStore.getState().inboxMessages).toHaveLength(2)
  })

  it('setInboxUnreadCount updates count', () => {
    useInboxStore.getState().setInboxUnreadCount(5)
    expect(useInboxStore.getState().inboxUnreadCount).toBe(5)

    useInboxStore.getState().setInboxUnreadCount(0)
    expect(useInboxStore.getState().inboxUnreadCount).toBe(0)
  })

  it('setInboxFilter updates filter', () => {
    useInboxStore.getState().setInboxFilter({ category: 'hook_event', status: 'unread' })
    expect(useInboxStore.getState().inboxFilter).toEqual({ category: 'hook_event', status: 'unread' })

    useInboxStore.getState().setInboxFilter({ search: 'test' })
    expect(useInboxStore.getState().inboxFilter).toEqual({ search: 'test' })
  })

  it('setInboxState atomically updates messages + unread count', () => {
    const messages: InboxMessage[] = [
      makeTestInboxMessage({ id: 'msg-1' }),
      makeTestInboxMessage({ id: 'msg-2', status: 'read' })
    ]
    useInboxStore.getState().setInboxState({ messages, unreadCount: 1 })
    const state = useInboxStore.getState()
    expect(state.inboxMessages).toEqual(messages)
    expect(state.inboxUnreadCount).toBe(1)
  })

  it('reset() restores initial state', () => {
    useInboxStore.getState().setInboxMessages([makeTestInboxMessage()])
    useInboxStore.getState().setInboxUnreadCount(5)
    useInboxStore.getState().setInboxFilter({ search: 'test' })

    useInboxStore.getState().reset()

    const state = useInboxStore.getState()
    expect(state.inboxMessages).toEqual([])
    expect(state.inboxUnreadCount).toBe(0)
    expect(state.inboxFilter).toEqual({})
  })
})

describe('inboxStore - optimistic updates', () => {
  const mockCcboard = {
    'update-inbox-message': vi.fn().mockResolvedValue(makeTestInboxMessage({ status: 'read' })),
    'dismiss-inbox-message': vi.fn().mockResolvedValue(true),
    'mark-all-inbox-read': vi.fn().mockResolvedValue(2)
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    mockCcboard['update-inbox-message'].mockResolvedValue(makeTestInboxMessage({ status: 'read' }))
    mockCcboard['dismiss-inbox-message'].mockResolvedValue(true)
    mockCcboard['mark-all-inbox-read'].mockResolvedValue(2)

    ;(globalThis as any).window = { opencow: mockCcboard }

    useInboxStore.setState({
      inboxMessages: [
        makeTestInboxMessage({ id: 'msg-1', status: 'unread' }),
        makeTestInboxMessage({ id: 'msg-2', status: 'unread' }),
        makeTestInboxMessage({ id: 'msg-3', status: 'read' })
      ],
      inboxUnreadCount: 2,
      inboxFilter: {}
    })
  })

  afterEach(() => {
    delete (globalThis as any).window
  })

  it('markAllInboxRead optimistically sets unreadCount to 0 and marks all read', async () => {
    const promise = useInboxStore.getState().markAllInboxRead()

    // Check state immediately (before IPC resolves)
    const state = useInboxStore.getState()
    expect(state.inboxUnreadCount).toBe(0)
    expect(state.inboxMessages.every(m => m.status === 'read')).toBe(true)

    await promise
  })

  it('markInboxRead optimistically marks single message as read', async () => {
    const promise = useInboxStore.getState().markInboxRead('msg-1')

    const state = useInboxStore.getState()
    const msg = state.inboxMessages.find(m => m.id === 'msg-1')
    expect(msg?.status).toBe('read')
    expect(state.inboxUnreadCount).toBe(1) // was 2, decremented by 1

    await promise
  })

  it('markInboxRead does not decrement count for already-read message', async () => {
    const promise = useInboxStore.getState().markInboxRead('msg-3')

    const state = useInboxStore.getState()
    expect(state.inboxUnreadCount).toBe(2) // unchanged

    await promise
  })

  it('archiveInboxMessage optimistically removes message and decrements count', async () => {
    const promise = useInboxStore.getState().archiveInboxMessage('msg-1')

    const state = useInboxStore.getState()
    expect(state.inboxMessages.find(m => m.id === 'msg-1')).toBeUndefined()
    expect(state.inboxMessages).toHaveLength(2)
    expect(state.inboxUnreadCount).toBe(1) // was unread, so decremented

    await promise
  })

  it('dismissInboxMessage optimistically removes message and decrements count', async () => {
    const promise = useInboxStore.getState().dismissInboxMessage('msg-2')

    const state = useInboxStore.getState()
    expect(state.inboxMessages.find(m => m.id === 'msg-2')).toBeUndefined()
    expect(state.inboxMessages).toHaveLength(2)
    expect(state.inboxUnreadCount).toBe(1)

    await promise
  })
})
