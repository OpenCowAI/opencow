// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleStore — Schedule and pipeline state.
 *
 * Manages schedule CRUD operations, pipeline management,
 * execution history, and selected schedule tracking.
 *
 * Completely independent of all other stores — no cross-store reads
 * or writes. Cross-store coordination (e.g. selectSchedule updating
 * the detail panel) is handled by `actions/scheduleActions.ts`.
 *
 * Populated by:
 *   - bootstrapCoordinator (loadSchedules, loadPipelines)
 *   - DataBus schedule:* events in useAppBootstrap
 */

import { create } from 'zustand'
import type {
  Schedule,
  SchedulePipeline,
  ScheduleExecution,
  CreateScheduleInput,
  UpdateScheduleInput,
  CreatePipelineInput,
  UpdatePipelineInput,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Store Interface ──────────────────────────────────────────────────

export interface ScheduleStore {
  schedules: Schedule[]
  pipelines: SchedulePipeline[]
  selectedScheduleId: string | null
  scheduleExecutions: Record<string, ScheduleExecution[]>

  loadSchedules: () => Promise<void>
  createSchedule: (input: CreateScheduleInput) => Promise<Schedule>
  updateSchedule: (id: string, patch: UpdateScheduleInput) => Promise<void>
  deleteSchedule: (id: string) => Promise<void>
  pauseSchedule: (id: string) => Promise<void>
  resumeSchedule: (id: string) => Promise<void>
  triggerNow: (id: string) => Promise<void>
  setSelectedScheduleId: (id: string | null) => void
  loadExecutions: (scheduleId: string) => Promise<void>

  loadPipelines: () => Promise<void>
  createPipeline: (input: CreatePipelineInput) => Promise<SchedulePipeline>
  updatePipeline: (id: string, patch: UpdatePipelineInput) => Promise<void>
  deletePipeline: (id: string) => Promise<void>

  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  schedules: [] as Schedule[],
  pipelines: [] as SchedulePipeline[],
  selectedScheduleId: null as string | null,
  scheduleExecutions: {} as Record<string, ScheduleExecution[]>,
}

// ─── Store Instance ───────────────────────────────────────────────────

export const useScheduleStore = create<ScheduleStore>((set, get) => ({
  ...initialState,

  loadSchedules: async () => {
    const schedules = await getAppAPI()['schedule:list']()
    set({ schedules })
  },

  createSchedule: async (input) => {
    // State is updated exclusively via the DataBus 'schedule:created' event
    // (single source of truth — same pattern as ManagedSession).
    return await getAppAPI()['schedule:create'](input)
  },

  updateSchedule: async (id, patch) => {
    const updated = await getAppAPI()['schedule:update'](id, patch)
    if (updated) {
      set((s) => ({
        schedules: s.schedules.map((sc) => (sc.id === id ? updated : sc)),
      }))
    }
  },

  deleteSchedule: async (id) => {
    await getAppAPI()['schedule:delete'](id)
    set((s) => ({
      schedules: s.schedules.filter((sc) => sc.id !== id),
    }))
  },

  pauseSchedule: async (id) => {
    const updated = await getAppAPI()['schedule:pause'](id)
    if (updated) {
      set((s) => ({
        schedules: s.schedules.map((sc) => (sc.id === id ? updated : sc)),
      }))
    }
  },

  resumeSchedule: async (id) => {
    const updated = await getAppAPI()['schedule:resume'](id)
    if (updated) {
      set((s) => ({
        schedules: s.schedules.map((sc) => (sc.id === id ? updated : sc)),
      }))
    }
  },

  triggerNow: async (id) => {
    await getAppAPI()['schedule:trigger-now'](id)
  },

  setSelectedScheduleId: (id) => set({ selectedScheduleId: id }),

  loadExecutions: async (scheduleId) => {
    // Eagerly initialise the key so subscribers never observe `undefined`.
    // This avoids the `?? []` anti-pattern in selectors that creates a new
    // array reference on every render, causing Zustand to call forceStoreRerender
    // in an infinite loop (Maximum update depth exceeded).
    set((s) => ({
      scheduleExecutions: {
        ...s.scheduleExecutions,
        [scheduleId]: s.scheduleExecutions[scheduleId] ?? [],
      },
    }))
    const executions = await getAppAPI()['schedule:list-executions'](scheduleId)
    set((s) => ({
      scheduleExecutions: { ...s.scheduleExecutions, [scheduleId]: executions },
    }))
  },

  loadPipelines: async () => {
    const pipelines = await getAppAPI()['pipeline:list']()
    set({ pipelines })
  },

  createPipeline: async (input) => {
    const pipeline = await getAppAPI()['pipeline:create'](input)
    set((s) => ({ pipelines: [pipeline, ...s.pipelines] }))
    return pipeline
  },

  updatePipeline: async (id, patch) => {
    const updated = await getAppAPI()['pipeline:update'](id, patch)
    if (updated) {
      set((s) => ({
        pipelines: s.pipelines.map((p) => (p.id === id ? updated : p)),
      }))
    }
  },

  deletePipeline: async (id) => {
    await getAppAPI()['pipeline:delete'](id)
    set((s) => ({
      pipelines: s.pipelines.filter((p) => p.id !== id),
    }))
  },

  reset: () => set(initialState),
}))
