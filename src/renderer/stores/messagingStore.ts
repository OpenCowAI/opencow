// SPDX-License-Identifier: Apache-2.0

/**
 * messagingStore — Messaging connection status state.
 *
 * Manages IM connection statuses (e.g. Slack, Discord) with
 * cache-aware loading. Completely independent of other stores.
 *
 * Populated by:
 *   - bootstrapCoordinator (supplementary load)
 *   - DataBus `messaging:status` event in useAppBootstrap
 */

import { create } from 'zustand'
import type { IMConnectionStatus } from '@shared/types'
import {
  queryMessagingConnectionStatuses,
  primeMessagingConnectionStatusesCache,
  primeMessagingConnectionStatusCache,
} from '@/lib/query/messagingStatusQueryService'

// ─── Input Types ──────────────────────────────────────────────────────

interface SetMessagingConnectionStatusesInput {
  statuses: IMConnectionStatus[]
}

interface UpsertMessagingConnectionStatusInput {
  status: IMConnectionStatus
}

interface LoadMessagingConnectionStatusesInput {
  force?: boolean
}

// ─── Store Interface ──────────────────────────────────────────────────

export interface MessagingStore {
  messagingConnectionStatuses: Map<string, IMConnectionStatus>
  setMessagingConnectionStatuses: (input: SetMessagingConnectionStatusesInput) => void
  upsertMessagingConnectionStatus: (input: UpsertMessagingConnectionStatusInput) => void
  loadMessagingConnectionStatuses: (input?: LoadMessagingConnectionStatusesInput) => Promise<void>
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  messagingConnectionStatuses: new Map<string, IMConnectionStatus>(),
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useMessagingStore = create<MessagingStore>((set, get) => ({
  ...initialState,

  setMessagingConnectionStatuses: ({ statuses }) => {
    primeMessagingConnectionStatusesCache({ statuses })
    set({
      messagingConnectionStatuses: new Map(statuses.map((status) => [status.connectionId, status])),
    })
  },

  upsertMessagingConnectionStatus: ({ status }) => {
    primeMessagingConnectionStatusCache({ status })
    set((s) => {
      const next = new Map(s.messagingConnectionStatuses)
      next.set(status.connectionId, status)
      return { messagingConnectionStatuses: next }
    })
  },

  loadMessagingConnectionStatuses: async ({ force = false } = {}) => {
    const statuses = await queryMessagingConnectionStatuses({ force })
    get().setMessagingConnectionStatuses({ statuses })
  },

  reset: () => set({ messagingConnectionStatuses: new Map() }),
}))
