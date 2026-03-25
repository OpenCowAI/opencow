// SPDX-License-Identifier: Apache-2.0

/**
 * artifactsStore — Starred artifacts state.
 *
 * Manages starred artifact items with IPC-backed load/toggle.
 * Completely independent of all other stores.
 */

import { create } from 'zustand'
import type { Artifact } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Store Interface ──────────────────────────────────────────────────

export interface ArtifactsStore {
  starredArtifacts: Artifact[]
  loadStarredArtifacts: (projectId?: string) => Promise<void>
  toggleArtifactStar: (id: string, starred: boolean) => Promise<void>
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  starredArtifacts: [] as Artifact[],
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useArtifactsStore = create<ArtifactsStore>((set) => ({
  ...initialState,

  loadStarredArtifacts: async (projectId) => {
    const artifacts = await getAppAPI()['list-starred-artifacts'](projectId)
    set({ starredArtifacts: artifacts })
  },

  toggleArtifactStar: async (id, starred) => {
    // Optimistic update
    set((s) => ({
      starredArtifacts: starred
        ? s.starredArtifacts // Will be added on next load
        : s.starredArtifacts.filter((a) => a.id !== id),
    }))
    await getAppAPI()['update-artifact-meta'](id, { starred })
  },

  reset: () => set(initialState),
}))
