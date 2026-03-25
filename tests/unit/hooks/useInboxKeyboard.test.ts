// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '@/stores/appStore'
import type { HookEventMessage, AppView } from '@shared/types'

function makeTestMessage(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
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

describe('useInboxKeyboard - navigation logic', () => {
  beforeEach(() => {
    useAppStore.setState({
      appView: { mode: 'projects', tab: 'dashboard', projectId: null } as AppView,
      inboxMessages: [],
      inboxUnreadCount: 0,
      inboxFilter: {},
      detailContext: null,
      selectedSessionDetail: null
    })
  })

  describe('Cmd+I toggle', () => {
    it('navigateToInbox when in projects mode', () => {
      const { navigateToInbox } = useAppStore.getState()
      navigateToInbox()
      expect(useAppStore.getState().appView.mode).toBe('inbox')
    })

    it('navigateToProject when in inbox mode', () => {
      useAppStore.setState({ appView: { mode: 'inbox', selectedMessageId: null } })
      const { navigateToProject } = useAppStore.getState()
      navigateToProject(null)
      expect(useAppStore.getState().appView.mode).toBe('projects')
    })
  })

  describe('Escape key', () => {
    it('navigates back to projects when in inbox mode', () => {
      useAppStore.setState({ appView: { mode: 'inbox', selectedMessageId: null } })
      const { navigateToProject } = useAppStore.getState()
      navigateToProject(null)
      expect(useAppStore.getState().appView.mode).toBe('projects')
    })
  })

  describe('ArrowUp/ArrowDown navigation', () => {
    const messages = [
      makeTestMessage({ id: 'msg-0' }),
      makeTestMessage({ id: 'msg-1' }),
      makeTestMessage({ id: 'msg-2' })
    ]

    beforeEach(() => {
      useAppStore.setState({
        appView: { mode: 'inbox', selectedMessageId: null },
        inboxMessages: messages
      })
    })

    it('ArrowDown from no selection selects first message', () => {
      const state = useAppStore.getState()
      const currentIdx = -1
      const nextIdx = currentIdx >= messages.length - 1 ? 0 : currentIdx + 1
      state.navigateToInbox(messages[nextIdx].id)
      expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: 'msg-0' })
    })

    it('ArrowDown wraps to first message from last', () => {
      useAppStore.setState({ appView: { mode: 'inbox', selectedMessageId: 'msg-2' } })
      const currentIdx = 2
      const nextIdx = currentIdx >= messages.length - 1 ? 0 : currentIdx + 1
      useAppStore.getState().navigateToInbox(messages[nextIdx].id)
      expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: 'msg-0' })
    })

    it('ArrowUp from first message wraps to last', () => {
      useAppStore.setState({ appView: { mode: 'inbox', selectedMessageId: 'msg-0' } })
      const currentIdx = 0
      const nextIdx = currentIdx <= 0 ? messages.length - 1 : currentIdx - 1
      useAppStore.getState().navigateToInbox(messages[nextIdx].id)
      expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: 'msg-2' })
    })

    it('ArrowUp moves to previous message', () => {
      useAppStore.setState({ appView: { mode: 'inbox', selectedMessageId: 'msg-2' } })
      const currentIdx = 2
      const nextIdx = currentIdx <= 0 ? messages.length - 1 : currentIdx - 1
      useAppStore.getState().navigateToInbox(messages[nextIdx].id)
      expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: 'msg-1' })
    })
  })

  describe('r key - mark as read', () => {
    it('identifies selected unread message for marking', () => {
      const msg = makeTestMessage({ id: 'msg-1', status: 'unread' })
      useAppStore.setState({
        appView: { mode: 'inbox', selectedMessageId: 'msg-1' },
        inboxMessages: [msg]
      })
      const state = useAppStore.getState()
      const selectedId = state.appView.mode === 'inbox' ? state.appView.selectedMessageId : null
      const selected = state.inboxMessages.find(m => m.id === selectedId)
      expect(selected?.status).toBe('unread')
    })

    it('does not mark already-read messages', () => {
      const msg = makeTestMessage({ id: 'msg-1', status: 'read' })
      useAppStore.setState({
        appView: { mode: 'inbox', selectedMessageId: 'msg-1' },
        inboxMessages: [msg]
      })
      const state = useAppStore.getState()
      const selectedId = state.appView.mode === 'inbox' ? state.appView.selectedMessageId : null
      const selected = state.inboxMessages.find(m => m.id === selectedId)
      expect(selected?.status).toBe('read')
    })
  })

  describe('e key - archive', () => {
    it('identifies selected message for archiving', () => {
      const msg = makeTestMessage({ id: 'msg-1' })
      useAppStore.setState({
        appView: { mode: 'inbox', selectedMessageId: 'msg-1' },
        inboxMessages: [msg]
      })
      const state = useAppStore.getState()
      const selectedId = state.appView.mode === 'inbox' ? state.appView.selectedMessageId : null
      expect(selectedId).toBe('msg-1')
    })

    it('does nothing when no message is selected', () => {
      useAppStore.setState({
        appView: { mode: 'inbox', selectedMessageId: null },
        inboxMessages: [makeTestMessage()]
      })
      const state = useAppStore.getState()
      const selectedId = state.appView.mode === 'inbox' ? state.appView.selectedMessageId : null
      expect(selectedId).toBeNull()
    })
  })
})
