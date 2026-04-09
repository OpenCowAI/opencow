// SPDX-License-Identifier: Apache-2.0

import { useReducer } from 'react'
import type { TFunction } from 'i18next'
import { DEFAULT_PROMPT_TEMPLATE } from './constants'
import type { FreqPreset } from './constants'
import type {
  FrequencyType,
  ActionType,
  ContextInjectionType,
  Schedule,
  ScheduleTrigger,
  ScheduleAction,
  CreateScheduleInput,
} from '@shared/types'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface TimeFreqState {
  freqType: FrequencyType
  intervalMinutes: number
  timeOfDay: string
  daysOfWeek: number[]
  cronExpression: string
  /** Single source of truth for preset highlight. Cleared on any manual edit. */
  selectedPresetLabel: string | null
  /**
   * `once` mode only: datetime-local string, e.g. "2026-03-01T14:30".
   * Stored as a string so it maps directly to <input type="datetime-local">.
   * Converted to a Unix ms timestamp in buildTrigger().
   */
  executeAt: string
}

export interface FormState {
  name: string
  description: string
  projectId: string | null

  triggerMode: 'time' | 'event'
  timeTrigger: TimeFreqState
  eventTrigger: { matcherType: string }

  action: {
    type: ActionType
    promptTemplate: string
    systemPrompt: string
    contextInjections: ContextInjectionType[]
  }

  error: string | null
  saving: boolean
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type FormAction =
  | { type: 'SET_NAME';             payload: string }
  | { type: 'SET_DESCRIPTION';      payload: string }
  | { type: 'SET_PROJECT';          payload: string | null }
  | { type: 'SET_TRIGGER_MODE';     payload: 'time' | 'event' }
  | { type: 'APPLY_FREQ_PRESET';    payload: FreqPreset }
  | { type: 'SET_FREQ_TYPE';        payload: FrequencyType }
  | { type: 'SET_INTERVAL_MINUTES'; payload: number }
  | { type: 'SET_TIME_OF_DAY';      payload: string }
  | { type: 'TOGGLE_DAY';           payload: number }
  | { type: 'SET_CRON';             payload: string }
  /** `once` mode: datetime-local string, e.g. "2026-03-01T14:30" */
  | { type: 'SET_EXECUTE_AT';       payload: string }
  | { type: 'SET_EVENT_MATCHER';    payload: string }
  | { type: 'SET_ACTION_TYPE';      payload: ActionType }
  | { type: 'SET_PROMPT';           payload: string }
  | { type: 'SET_SYSTEM_PROMPT';    payload: string }
  | { type: 'TOGGLE_INJECTION';     payload: ContextInjectionType }
  | { type: 'SET_ERROR';            payload: string | null }
  | { type: 'SET_SAVING';           payload: boolean }

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_TIME_TRIGGER: TimeFreqState = {
  freqType: 'daily',
  intervalMinutes: 60,
  timeOfDay: '09:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  cronExpression: '0 9 * * 1-5',
  selectedPresetLabel: 'Daily',
  executeAt: '',
}

const INITIAL_STATE: FormState = {
  name: '',
  description: '',
  projectId: null,
  triggerMode: 'time',
  timeTrigger: INITIAL_TIME_TRIGGER,
  eventTrigger: { matcherType: 'session:idle' },
  action: {
    type: 'start_session',
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    systemPrompt: '',
    contextInjections: [],
  },
  error: null,
  saving: false,
}

// ---------------------------------------------------------------------------
// Default values (for AI Creator pre-fill without a full Schedule entity)
// ---------------------------------------------------------------------------

export interface ScheduleFormDefaultValues {
  name?: string
  description?: string
  projectId?: string | null
  triggerMode?: 'time' | 'event'
  timeTrigger?: Partial<TimeFreqState>
  action?: {
    type?: ActionType
    promptTemplate?: string
    systemPrompt?: string
    contextInjections?: ContextInjectionType[]
  }
}

function applyDefaultValues(base: FormState, dv: ScheduleFormDefaultValues): FormState {
  return {
    ...base,
    name:        dv.name        ?? base.name,
    description: dv.description ?? base.description,
    projectId:   dv.projectId !== undefined ? dv.projectId : base.projectId,
    triggerMode:  dv.triggerMode ?? base.triggerMode,
    timeTrigger: dv.timeTrigger
      ? { ...base.timeTrigger, ...dv.timeTrigger, selectedPresetLabel: null }
      : base.timeTrigger,
    action: dv.action
      ? {
          ...base.action,
          type:              dv.action.type              ?? base.action.type,
          promptTemplate:    dv.action.promptTemplate    ?? base.action.promptTemplate,
          systemPrompt:      dv.action.systemPrompt      ?? base.action.systemPrompt,
          contextInjections: dv.action.contextInjections ?? base.action.contextInjections,
        }
      : base.action,
  }
}

// ---------------------------------------------------------------------------
// Schedule → FormState conversion (for edit mode)
// ---------------------------------------------------------------------------

/**
 * Converts an existing Schedule entity back into the form's mutable state so
 * that ScheduleFormModal can pre-fill all fields when opened in edit mode.
 */
export function scheduleToFormState(schedule: Schedule): FormState {
  const t       = schedule.trigger
  const isEvent = !!t.event

  // datetime-local inputs expect "YYYY-MM-DDTHH:mm" (local time, no seconds)
  const executeAt = t.time?.executeAt
    ? new Date(t.time.executeAt).toISOString().slice(0, 16)
    : ''

  const timeTrigger: TimeFreqState = {
    freqType:           t.time?.type            ?? 'daily',
    intervalMinutes:    t.time?.intervalMinutes  ?? 60,
    timeOfDay:          t.time?.timeOfDay        ?? '09:00',
    daysOfWeek:         t.time?.daysOfWeek       ?? [1, 2, 3, 4, 5],
    cronExpression:     t.time?.cronExpression   ?? '0 9 * * 1-5',
    selectedPresetLabel: null,   // let the UI recompute from values
    executeAt,
  }

  return {
    name:         schedule.name,
    description:  schedule.description ?? '',
    projectId:    schedule.action.projectId ?? null,
    triggerMode:  isEvent ? 'event' : 'time',
    timeTrigger,
    eventTrigger: { matcherType: t.event?.matcherType ?? 'session:idle' },
    action: {
      type:              schedule.action.type,
      promptTemplate:    schedule.action.session?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE,
      systemPrompt:      schedule.action.session?.systemPrompt ?? '',
      contextInjections: schedule.action.contextInjections ?? [],
    },
    error:  null,
    saving: false,
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME':        return { ...state, name: action.payload, error: null }
    case 'SET_DESCRIPTION': return { ...state, description: action.payload }
    case 'SET_PROJECT':     return { ...state, projectId: action.payload }
    case 'SET_TRIGGER_MODE':return { ...state, triggerMode: action.payload }

    case 'APPLY_FREQ_PRESET': {
      const p = action.payload
      return {
        ...state,
        timeTrigger: {
          ...state.timeTrigger,
          freqType: p.type,
          ...(p.intervalMinutes !== undefined && { intervalMinutes: p.intervalMinutes }),
          ...(p.timeOfDay       !== undefined && { timeOfDay:       p.timeOfDay }),
          selectedPresetLabel: p.label,
        },
      }
    }

    case 'SET_FREQ_TYPE':
      return { ...state, timeTrigger: { ...state.timeTrigger, freqType: action.payload, selectedPresetLabel: null } }

    case 'SET_INTERVAL_MINUTES':
      return { ...state, timeTrigger: { ...state.timeTrigger, intervalMinutes: action.payload, selectedPresetLabel: null } }

    case 'SET_TIME_OF_DAY':
      return { ...state, timeTrigger: { ...state.timeTrigger, timeOfDay: action.payload, selectedPresetLabel: null } }

    case 'TOGGLE_DAY': {
      const day  = action.payload
      const days = state.timeTrigger.daysOfWeek
      return {
        ...state,
        timeTrigger: {
          ...state.timeTrigger,
          daysOfWeek: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
          selectedPresetLabel: null,
        },
      }
    }

    case 'SET_CRON':
      return { ...state, timeTrigger: { ...state.timeTrigger, cronExpression: action.payload, selectedPresetLabel: null } }

    case 'SET_EXECUTE_AT':
      return { ...state, timeTrigger: { ...state.timeTrigger, executeAt: action.payload } }

    case 'SET_EVENT_MATCHER':
      return { ...state, eventTrigger: { matcherType: action.payload } }

    case 'SET_ACTION_TYPE':
      return { ...state, action: { ...state.action, type: action.payload } }

    case 'SET_PROMPT':
      return { ...state, action: { ...state.action, promptTemplate: action.payload } }

    case 'SET_SYSTEM_PROMPT':
      return { ...state, action: { ...state.action, systemPrompt: action.payload } }

    case 'TOGGLE_INJECTION': {
      const inj  = action.payload
      const curr = state.action.contextInjections
      return {
        ...state,
        action: {
          ...state.action,
          contextInjections: curr.includes(inj) ? curr.filter((i) => i !== inj) : [...curr, inj],
        },
      }
    }

    case 'SET_ERROR':  return { ...state, error:  action.payload }
    case 'SET_SAVING': return { ...state, saving: action.payload }

    default: return state
  }
}

// ---------------------------------------------------------------------------
// Pure build helpers (called at submit time — no hooks dependency)
// ---------------------------------------------------------------------------

export function buildScheduleInput(state: FormState): CreateScheduleInput {
  return {
    name:        state.name.trim(),
    description: state.description.trim() || undefined,
    trigger:     buildTrigger(state),
    action:      buildAction(state),
    projectId:   state.projectId,
  }
}

function buildTrigger(state: FormState): ScheduleTrigger {
  if (state.triggerMode === 'event') {
    return {
      event: {
        matcherType: state.eventTrigger.matcherType,
        filter: state.projectId ? { projectId: state.projectId } : {},
      },
    }
  }

  const t    = state.timeTrigger
  const base = {
    type:     t.freqType,
    workMode: 'all_days' as const,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }

  if (t.freqType === 'once') {
    return {
      time: {
        ...base,
        // executeAt is a datetime-local string → convert to Unix ms
        executeAt: t.executeAt ? new Date(t.executeAt).getTime() : undefined,
      },
    }
  }

  return {
    time: {
      ...base,
      ...(t.freqType === 'interval'                    && { intervalMinutes: t.intervalMinutes }),
      ...(t.freqType !== 'interval' && t.freqType !== 'cron' && { timeOfDay: t.timeOfDay }),
      ...(t.freqType === 'weekly'                      && { daysOfWeek:      t.daysOfWeek }),
      ...(t.freqType === 'cron'                        && { cronExpression:  t.cronExpression }),
    },
  }
}

function buildAction(state: FormState): ScheduleAction {
  const { action, projectId } = state
  const base: ScheduleAction = {
    type:              action.type,
    projectId:         projectId ?? undefined,
    contextInjections: action.contextInjections.length > 0 ? action.contextInjections : undefined,
  }
  if (action.type === 'start_session' || action.type === 'resume_session') {
    base.session = {
      promptTemplate: action.promptTemplate,
      systemPrompt: action.systemPrompt.trim() || undefined,
      permissionMode: 'default',
    }
  }
  return base
}

// ---------------------------------------------------------------------------
// Next-run preview (pure, no I/O — covers interval / daily / weekly)
// ---------------------------------------------------------------------------

export function computeNextRunPreview(ts: TimeFreqState, t: TFunction): string | null {
  const now = new Date()

  if (ts.freqType === 'once') {
    if (!ts.executeAt) return null
    const target = new Date(ts.executeAt)
    if (target <= now) return t('trigger.nextRun.pastWarning')
    return formatNextRun(target, now, t)
  }

  if (ts.freqType === 'interval') {
    if (ts.intervalMinutes <= 0) return null
    return formatNextRun(new Date(now.getTime() + ts.intervalMinutes * 60_000), now, t)
  }

  if (ts.freqType === 'daily') {
    const [h, m] = parseTime(ts.timeOfDay)
    const next   = new Date(now)
    next.setHours(h, m, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    return formatNextRun(next, now, t)
  }

  if (ts.freqType === 'weekly') {
    if (ts.daysOfWeek.length === 0) return null
    const [h, m]    = parseTime(ts.timeOfDay)
    const todayDay  = now.getDay()
    const todayMins = now.getHours() * 60 + now.getMinutes()
    const targetMins = h * 60 + m
    const sorted    = [...ts.daysOfWeek].sort((a, b) => a - b)

    for (let offset = 0; offset <= 7; offset++) {
      const day = (todayDay + offset) % 7
      if (sorted.includes(day) && (offset > 0 || targetMins > todayMins)) {
        const next = new Date(now)
        next.setDate(now.getDate() + offset)
        next.setHours(h, m, 0, 0)
        return formatNextRun(next, now, t)
      }
    }
    return null
  }

  return null
}

function parseTime(timeOfDay: string): [number, number] {
  const [hStr, mStr] = timeOfDay.split(':')
  return [parseInt(hStr ?? '9', 10), parseInt(mStr ?? '0', 10)]
}

function formatNextRun(next: Date, now: Date, t: TFunction): string {
  const diffMins = Math.round((next.getTime() - now.getTime()) / 60_000)
  const timeStr  = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)

  const dayStr =
    next.toDateString() === now.toDateString()      ? t('trigger.nextRun.today') :
    next.toDateString() === tomorrow.toDateString() ? t('trigger.nextRun.tomorrow') :
    next.toLocaleDateString([], { month: 'short', day: 'numeric' })

  const diffStr =
    diffMins <  60     ? t('trigger.nextRun.inMinutes', { count: diffMins }) :
    diffMins <  24*60  ? t('trigger.nextRun.inHours',   { count: Math.round(diffMins / 60) }) :
                         t('trigger.nextRun.inDays',    { count: Math.round(diffMins / 60 / 24) })

  return t('trigger.nextRun.format', { day: dayStr, time: timeStr, diff: diffStr })
}

/** Human-readable hint for interval (e.g. "Runs every hour") */
export function intervalHint(minutes: number, t: TFunction): string {
  if (minutes <= 0)         return ''
  if (minutes < 60)         return t('trigger.intervalHint.everyNMinutes', { count: minutes })
  if (minutes === 60)       return t('trigger.intervalHint.everyHour')
  if (minutes < 24 * 60)   return t('trigger.intervalHint.everyNHours',   { count: Math.round(minutes / 60) })
  if (minutes === 24 * 60)  return t('trigger.intervalHint.everyDay')
  return t('trigger.intervalHint.everyNDays', { count: Math.round(minutes / 60 / 24) })
}

// ---------------------------------------------------------------------------
// Hook (public API)
// ---------------------------------------------------------------------------

export function useScheduleForm(initialSchedule?: Schedule, defaultValues?: ScheduleFormDefaultValues) {
  const [state, dispatch] = useReducer(
    reducer,
    initialSchedule
      ? scheduleToFormState(initialSchedule)
      : defaultValues
        ? applyDefaultValues(INITIAL_STATE, defaultValues)
        : INITIAL_STATE,
  )

  // `once` mode requires a future executeAt before the form is submittable
  const onceValid =
    state.triggerMode !== 'time' ||
    state.timeTrigger.freqType !== 'once' ||
    (!!state.timeTrigger.executeAt && new Date(state.timeTrigger.executeAt) > new Date())

  const canSubmit = state.name.trim().length > 0 && !state.saving && onceValid

  return { state, dispatch, canSubmit }
}
