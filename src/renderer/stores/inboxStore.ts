// SPDX-License-Identifier: Apache-2.0

/**
 * inboxStore — Inbox messages state.
 *
 * Manages inbox messages, unread count, and filter state.
 * All mutations use optimistic updates — UI reflects changes
 * immediately before IPC confirms.
 *
 * Populated by:
 *   - bootstrapCoordinator (initial load via get-initial-state)
 *   - DataBus `inbox:updated` event in useAppBootstrap
 */

import { create } from 'zustand'
import type { InboxMessage, InboxFilter, InboxMessageStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Input Types ──────────────────────────────────────────────────────

export interface InboxUpdatePayload {
  messages: InboxMessage[]
  unreadCount: number
}

// ─── Store Interface ──────────────────────────────────────────────────

export interface InboxStore {
  inboxMessages: InboxMessage[]
  inboxUnreadCount: number
  inboxFilter: InboxFilter

  /** Atomic update for messages + unread count (single re-render). */
  setInboxState: (payload: InboxUpdatePayload) => void

  setInboxMessages: (messages: InboxMessage[]) => void
  setInboxUnreadCount: (count: number) => void
  setInboxFilter: (filter: InboxFilter) => void
  markInboxRead: (id: string) => Promise<void>
  archiveInboxMessage: (id: string) => Promise<void>
  dismissInboxMessage: (id: string) => Promise<void>
  markAllInboxRead: () => Promise<void>
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  inboxMessages: [] as InboxMessage[],
  inboxUnreadCount: 0,
  inboxFilter: {} as InboxFilter,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useInboxStore = create<InboxStore>((set, get) => ({
  ...initialState,

  setInboxState: ({ messages, unreadCount }) =>
    set({ inboxMessages: messages, inboxUnreadCount: unreadCount }),

  setInboxMessages: (messages) => set({ inboxMessages: messages }),
  setInboxUnreadCount: (count) => set({ inboxUnreadCount: count }),
  setInboxFilter: (filter) => set({ inboxFilter: filter }),

  markInboxRead: async (id) => {
    const wasUnread = get().inboxMessages.find((m) => m.id === id)?.status === 'unread'
    set((s) => ({
      inboxMessages: s.inboxMessages.map((m) =>
        m.id === id && m.status === 'unread'
          ? { ...m, status: 'read' as InboxMessageStatus, readAt: Date.now() }
          : m,
      ),
      inboxUnreadCount: Math.max(0, s.inboxUnreadCount - (wasUnread ? 1 : 0)),
    }))
    await getAppAPI()['update-inbox-message']({ id, status: 'read' as InboxMessageStatus })
  },

  archiveInboxMessage: async (id) => {
    const msg = get().inboxMessages.find((m) => m.id === id)
    set((s) => ({
      inboxMessages: s.inboxMessages.filter((m) => m.id !== id),
      inboxUnreadCount: Math.max(0, s.inboxUnreadCount - (msg?.status === 'unread' ? 1 : 0)),
    }))
    await getAppAPI()['update-inbox-message']({ id, status: 'archived' as InboxMessageStatus })
  },

  dismissInboxMessage: async (id) => {
    const msg = get().inboxMessages.find((m) => m.id === id)
    set((s) => ({
      inboxMessages: s.inboxMessages.filter((m) => m.id !== id),
      inboxUnreadCount: Math.max(0, s.inboxUnreadCount - (msg?.status === 'unread' ? 1 : 0)),
    }))
    await getAppAPI()['dismiss-inbox-message'](id)
  },

  markAllInboxRead: async () => {
    set((s) => ({
      inboxMessages: s.inboxMessages.map((m) =>
        m.status === 'unread'
          ? { ...m, status: 'read' as InboxMessageStatus, readAt: Date.now() }
          : m,
      ),
      inboxUnreadCount: 0,
    }))
    await getAppAPI()['mark-all-inbox-read']()
  },

  reset: () => set(initialState),
}))
