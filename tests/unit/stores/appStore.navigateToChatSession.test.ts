// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_TAB_DETAILS, useAppStore } from '../../../src/renderer/stores/appStore'
import type { AppView, DetailContext } from '../../../src/shared/types'

describe('appStore navigateToChatSession', () => {
  beforeEach(() => {
    const sessionDetail: DetailContext = { type: 'session', sessionId: 'old-session' }
    useAppStore.setState({
      appView: { mode: 'inbox', selectedMessageId: 'msg-1' } as AppView,
      detailContext: sessionDetail,
      selectedSessionDetail: { id: 'old-session' } as never,
      _tabDetails: { ...EMPTY_TAB_DETAILS },
      _projectStates: {},
      selectedIssueId: null,
      chatSubTab: 'sessions',
      agentChatSessionId: null,
      statusFilter: 'all',
      searchQuery: '',
      contentSearchResults: null,
      contentSearching: false,
    })
  })

  it('opens Chat tab and selects target chat session without opening detail panel', () => {
    useAppStore.getState().navigateToChatSession('proj-chat', 'chat-session-1')
    const state = useAppStore.getState()

    expect(state.appView).toEqual({ mode: 'projects', tab: 'chat', projectId: 'proj-chat' })
    expect(state.agentChatSessionId).toBe('chat-session-1')
    expect(state.chatSubTab).toBe('conversation')
    expect(state.detailContext).toBeNull()
    expect(state.selectedSessionDetail).toBeNull()
  })
})
