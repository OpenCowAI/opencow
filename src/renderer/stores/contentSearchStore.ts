// SPDX-License-Identifier: Apache-2.0

/**
 * contentSearchStore — Session content search state.
 *
 * Manages search results and searching status for in-session
 * content search. Independent of other stores.
 *
 * Cross-store coordination: Navigation actions clear content search
 * when switching context. This is handled by the action coordinator
 * in `actions/navigationActions.ts` — this store does NOT import
 * any other store, and no other store imports this one directly.
 */

import { create } from 'zustand'
import type { SessionSearchResult } from '@shared/types'

// ─── Store Interface ──────────────────────────────────────────────────

export interface ContentSearchStore {
  contentSearchResults: SessionSearchResult[] | null
  contentSearching: boolean
  setContentSearchResults: (results: SessionSearchResult[] | null) => void
  setContentSearching: (searching: boolean) => void
  clearContentSearch: () => void
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  contentSearchResults: null as SessionSearchResult[] | null,
  contentSearching: false,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useContentSearchStore = create<ContentSearchStore>((set) => ({
  ...initialState,

  setContentSearchResults: (results) => set({ contentSearchResults: results }),
  setContentSearching: (searching) => set({ contentSearching: searching }),
  clearContentSearch: () => set({ contentSearchResults: null, contentSearching: false }),
  reset: () => set(initialState),
}))
