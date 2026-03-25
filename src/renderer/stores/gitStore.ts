// SPDX-License-Identifier: Apache-2.0

/**
 * gitStore — Per-project git repository state.
 *
 * Manages git snapshots keyed by project path. Completely independent
 * of all other stores — no cross-store reads or writes.
 *
 * Populated by the DataBus `git:status-changed` event in useAppBootstrap.
 */

import { create } from 'zustand'
import type { GitRepositorySnapshot } from '@shared/gitTypes'

// ─── Store Interface ──────────────────────────────────────────────────

export interface GitStore {
  /** Per-project git snapshots, keyed by project path. */
  gitSnapshots: Record<string, GitRepositorySnapshot>
  setGitStatus: (projectPath: string, snapshot: GitRepositorySnapshot) => void
  clearGitStatus: (projectPath: string) => void
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  gitSnapshots: {} as Record<string, GitRepositorySnapshot>,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useGitStore = create<GitStore>((set) => ({
  ...initialState,

  setGitStatus: (projectPath, snapshot) =>
    set((s) => ({
      gitSnapshots: { ...s.gitSnapshots, [projectPath]: snapshot },
    })),

  clearGitStatus: (projectPath) =>
    set((s) => {
      const { [projectPath]: _, ...rest } = s.gitSnapshots
      return { gitSnapshots: rest }
    }),

  reset: () => set(initialState),
}))
