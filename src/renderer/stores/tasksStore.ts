// SPDX-License-Identifier: Apache-2.0

/**
 * tasksStore — Session task lists state.
 *
 * Manages task lists keyed by session ID. Completely independent
 * of all other stores — no cross-store reads or writes.
 *
 * Populated by:
 *   - bootstrapCoordinator (initial load via get-initial-state)
 *   - DataBus `tasks:updated` event in useAppBootstrap
 */

import { create } from 'zustand'
import type { TaskFull } from '@shared/types'

// ─── Store Interface ──────────────────────────────────────────────────

export interface TasksStore {
  tasksByList: Record<string, TaskFull[]>
  setTasks: (sessionId: string, tasks: TaskFull[]) => void
  setAllTasks: (tasks: Record<string, TaskFull[]>) => void
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  tasksByList: {} as Record<string, TaskFull[]>,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useTasksStore = create<TasksStore>((set) => ({
  ...initialState,

  setTasks: (sessionId, tasks) =>
    set((s) => ({
      tasksByList: { ...s.tasksByList, [sessionId]: tasks },
    })),

  setAllTasks: (tasks) => set({ tasksByList: tasks }),

  reset: () => set(initialState),
}))
