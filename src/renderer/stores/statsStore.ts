// SPDX-License-Identifier: Apache-2.0

/**
 * statsStore — Application statistics state.
 *
 * Manages the stats snapshot (session counts, durations, etc.).
 * Completely independent of all other stores.
 *
 * Populated by:
 *   - bootstrapCoordinator (initial load via get-initial-state)
 *   - DataBus `stats:updated` event in useAppBootstrap
 */

import { create } from 'zustand'
import type { StatsSnapshot } from '@shared/types'

// ─── Store Interface ──────────────────────────────────────────────────

export interface StatsStore {
  stats: StatsSnapshot | null
  setStats: (stats: StatsSnapshot) => void
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  stats: null as StatsSnapshot | null,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useStatsStore = create<StatsStore>((set) => ({
  ...initialState,
  setStats: (stats) => set({ stats }),
  reset: () => set(initialState),
}))
