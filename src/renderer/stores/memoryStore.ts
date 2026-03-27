// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'
import { getAppAPI } from '@/windowAPI'
import type {
  MemoryItem,
  MemoryListParams,
  MemoryStats,
  MemorySettings,
  MemoryScope,
  MemoryCategory,
} from '@shared/types'

// ─── Types ─────────────────────────────────────────────────────────

/** A merge proposal waiting for user confirmation in the toast queue. */
export interface PendingMerge {
  pendingId: string
  targetId: string
  oldContent: string
  newContent: string
  category: MemoryCategory
}

/** A pending item in the toast queue — either a new memory or a merge proposal. */
export type PendingItem =
  | { kind: 'new'; memory: MemoryItem }
  | { kind: 'merge'; merge: PendingMerge }

export interface MemoryStore {
  // Data
  memories: MemoryItem[]
  pendingItems: PendingItem[]
  stats: MemoryStats | null
  settings: MemorySettings | null

  // Filters
  scopeFilter: MemoryScope | 'all'
  categoryFilter: MemoryCategory | null
  searchQuery: string

  // UI State
  isManagementOpen: boolean
  activeMemoryId: string | null

  // Create modal draft (persisted across open/close)
  draft: {
    content: string
    projectId: string | null
    category: MemoryCategory
  }

  // Actions — Data
  loadMemories: (params?: MemoryListParams) => Promise<void>
  loadStats: (projectId?: string) => Promise<void>
  loadSettings: (projectId?: string) => Promise<void>
  searchMemories: (query: string, overrides?: { scope?: MemoryScope; projectId?: string; category?: MemoryCategory }) => Promise<void>

  // Actions — CRUD
  createMemory: (input: Parameters<ReturnType<typeof getAppAPI>['memory:create']>[0]) => Promise<void>
  updateMemory: (id: string, patch: Parameters<ReturnType<typeof getAppAPI>['memory:update']>[1]) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  archiveMemory: (id: string) => Promise<void>
  bulkDelete: (ids: string[]) => Promise<void>
  bulkArchive: (ids: string[]) => Promise<void>

  // Actions — Perception (Toast queue)
  addPendingMemories: (items: MemoryItem[]) => void
  addPendingMerge: (merge: PendingMerge) => void
  shiftPendingItem: () => PendingItem | undefined
  confirmMemory: (id: string) => Promise<void>
  rejectMemory: (id: string) => Promise<void>
  editAndConfirmMemory: (id: string, content: string) => Promise<void>
  confirmMerge: (pendingId: string, targetId: string) => Promise<void>
  rejectMerge: (pendingId: string) => Promise<void>

  // Actions — UI
  setManagementOpen: (open: boolean) => void
  setActiveMemoryId: (id: string | null) => void
  setScopeFilter: (scope: MemoryScope | 'all') => void
  setCategoryFilter: (category: MemoryCategory | null) => void
  setSearchQuery: (query: string) => void
  updateDraft: (patch: Partial<MemoryStore['draft']>) => void
  clearDraft: () => void

  // Event handlers (from DataBus)
  onMemoryConfirmed: (item: MemoryItem) => void
  onMemoryRejected: (id: string) => void
  onMemoryUpdated: (item: MemoryItem) => void
  onMemoryDeleted: (id: string) => void
}

// ─── Store ─────────────────────────────────────────────────────────

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  // Initial state
  memories: [],
  pendingItems: [],
  stats: null,
  settings: null,
  scopeFilter: 'all',
  categoryFilter: null,
  searchQuery: '',
  isManagementOpen: false,
  activeMemoryId: null,
  draft: { content: '', projectId: null, category: 'fact' as MemoryCategory },

  // ── Data Loading ──

  loadMemories: async (params) => {
    const api = getAppAPI()
    const memories = await api['memory:list'](params ?? {
      status: 'confirmed',
      sortBy: 'updated_at',
      sortOrder: 'desc',
      limit: 200,
    })
    set({ memories })
  },

  loadStats: async (projectId) => {
    const api = getAppAPI()
    const stats = await api['memory:stats'](projectId)
    set({ stats })
  },

  loadSettings: async (projectId) => {
    const api = getAppAPI()
    const settings = await api['memory:get-settings'](projectId)
    set({ settings })
  },

  searchMemories: async (query, overrides) => {
    const api = getAppAPI()
    const memories = await api['memory:search']({
      query,
      scope: overrides?.scope,
      projectId: overrides?.projectId,
      category: overrides?.category,
      limit: 50,
    })
    set({ memories, searchQuery: query })
  },

  // ── CRUD ──

  createMemory: async (input) => {
    const api = getAppAPI()
    await api['memory:create'](input)
    await get().loadMemories()
  },

  updateMemory: async (id, patch) => {
    const api = getAppAPI()
    await api['memory:update'](id, patch)
    await get().loadMemories()
  },

  deleteMemory: async (id) => {
    const api = getAppAPI()
    await api['memory:delete'](id)
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
  },

  archiveMemory: async (id) => {
    const api = getAppAPI()
    await api['memory:archive'](id)
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
  },

  bulkDelete: async (ids) => {
    const api = getAppAPI()
    await api['memory:bulk-delete'](ids)
    set((state) => ({
      memories: state.memories.filter((m) => !ids.includes(m.id)),
    }))
  },

  bulkArchive: async (ids) => {
    const api = getAppAPI()
    await api['memory:bulk-archive'](ids)
    set((state) => ({
      memories: state.memories.filter((m) => !ids.includes(m.id)),
    }))
  },

  // ── Perception ──

  addPendingMemories: (items) => {
    const newItems: PendingItem[] = items.map((m) => ({ kind: 'new' as const, memory: m }))
    set((state) => ({ pendingItems: [...state.pendingItems, ...newItems] }))
  },

  addPendingMerge: (merge) => {
    set((state) => ({ pendingItems: [...state.pendingItems, { kind: 'merge' as const, merge }] }))
  },

  shiftPendingItem: () => {
    const { pendingItems } = get()
    if (pendingItems.length === 0) return undefined
    const [first, ...rest] = pendingItems
    set({ pendingItems: rest })
    return first
  },

  confirmMemory: async (id) => {
    const api = getAppAPI()
    await api['memory:confirm'](id)
  },

  rejectMemory: async (id) => {
    const api = getAppAPI()
    await api['memory:reject'](id)
  },

  editAndConfirmMemory: async (id, content) => {
    const api = getAppAPI()
    await api['memory:edit-and-confirm'](id, content)
  },

  confirmMerge: async (pendingId, targetId) => {
    const api = getAppAPI()
    await api['memory:confirm-merge'](pendingId, targetId)
  },

  rejectMerge: async (pendingId) => {
    const api = getAppAPI()
    await api['memory:reject-merge'](pendingId)
  },

  // ── UI ──

  setManagementOpen: (open) => set({ isManagementOpen: open }),
  setActiveMemoryId: (id) => set({ activeMemoryId: id }),
  setScopeFilter: (scope) => set({ scopeFilter: scope }),
  setCategoryFilter: (category) => set({ categoryFilter: category }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  updateDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () => set({ draft: { content: '', projectId: null, category: 'fact' as MemoryCategory } }),

  // ── DataBus Event Handlers ──

  onMemoryConfirmed: (item) => {
    set((state) => ({
      memories: [item, ...state.memories.filter((m) => m.id !== item.id)],
    }))
  },

  onMemoryRejected: (_id) => {
    // No-op: pendingItems are already shifted by the toast; DataBus event is informational
  },

  onMemoryUpdated: (item) => {
    set((state) => ({
      memories: state.memories.map((m) => (m.id === item.id ? item : m)),
    }))
  },

  onMemoryDeleted: (id) => {
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== id),
    }))
  },
}))
