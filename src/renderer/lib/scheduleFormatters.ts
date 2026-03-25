// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleFormatters — Shared formatting utilities for Schedule display.
 *
 * Extracted from ScheduleView.tsx to enable reuse across:
 *   - ScheduleListItem (list view)
 *   - ScheduleConfirmationCard (AI creator)
 *   - ScheduleDetailPanel (detail view)
 *
 * @module
 */

import type { Schedule } from '@shared/types'
import type { ParsedScheduleOutput } from '@shared/scheduleOutputParser'

// ─── Types ───────────────────────────────────────────────────────────────────

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string

interface EventTriggerOption {
  value: string
  labelKey: string
}

// ─── Shared formatting primitives ────────────────────────────────────────────

/** Format a once-type date+time string from a timestamp or ISO string. */
function formatOnceDate(ts: number | string, t: TranslateFn): string {
  const date = new Date(ts)
  if (isNaN(date.getTime())) return t('frequencyType.once')
  const now = new Date()
  const isThisYear = date.getFullYear() === now.getFullYear()
  const dateStr = date.toLocaleDateString([], {
    month: 'short', day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
  })
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${t('frequencyType.once')} · ${dateStr} ${timeStr}`
}

/** Format an interval duration in human-readable form. */
function formatInterval(mins: number, t: TranslateFn): string {
  if (mins >= 1440) return t('trigger.intervalHint.everyNDays', { count: Math.round(mins / 1440) })
  if (mins >= 60) {
    const hrs = Math.round(mins / 60)
    return hrs === 1
      ? t('trigger.intervalHint.everyHour')
      : t('trigger.intervalHint.everyNHours', { count: hrs })
  }
  return t('trigger.intervalHint.everyNMinutes', { count: mins })
}

/** Format a time-based frequency label with optional "@ HH:MM" suffix. */
function formatFreqAtTime(freqType: string, timeOfDay: string | undefined, t: TranslateFn): string {
  const label = t(`frequencyType.${freqType}`)
  return timeOfDay ? `${label} @ ${timeOfDay}` : label
}

// ─── Schedule entity → frequency summary ─────────────────────────────────────

/**
 * Format a human-readable frequency summary from a Schedule entity.
 *
 * @param schedule - Requires trigger and nextRunAt fields
 * @param t - Translation function scoped to 'schedule' namespace
 * @param eventOptions - Event trigger options for label lookup
 */
export function formatFrequencySummary(
  schedule: Pick<Schedule, 'trigger' | 'nextRunAt'>,
  t: TranslateFn,
  eventOptions?: readonly EventTriggerOption[]
): string | null {
  if (schedule.trigger.event) {
    const opt = eventOptions?.find(
      (o) => o.value === schedule.trigger.event?.matcherType
    )
    return opt ? t(opt.labelKey) : (schedule.trigger.event.matcherType ?? null)
  }

  if (schedule.trigger.time) {
    return formatFrequencyFromTime(schedule.trigger.time, schedule.nextRunAt, t)
  }

  return null
}

/**
 * Format a human-readable frequency summary from parsed AI output.
 * Used by ScheduleConfirmationCard to display frequency before creation.
 *
 * @param parsed - Parsed schedule output fields
 * @param t - Translation function scoped to 'schedule' namespace
 */
export function formatParsedFrequency(
  parsed: Pick<ParsedScheduleOutput, 'frequency' | 'timeOfDay' | 'intervalMinutes' | 'cronExpression' | 'executeAt' | 'daysOfWeek'>,
  t: TranslateFn
): string {
  switch (parsed.frequency) {
    case 'once':
      return parsed.executeAt
        ? formatOnceDate(parsed.executeAt, t)
        : t('frequencyType.once')
    case 'interval':
      return formatInterval(parsed.intervalMinutes ?? 60, t)
    case 'daily':
      return formatFreqAtTime('daily', parsed.timeOfDay, t)
    case 'weekly': {
      const base = formatFreqAtTime('weekly', parsed.timeOfDay, t)
      if (parsed.daysOfWeek && parsed.daysOfWeek.length > 0 && parsed.daysOfWeek.length < 7) {
        const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const dayLabels = parsed.daysOfWeek
          .sort((a, b) => a - b)
          .map((d) => t(`trigger.weekdays.${dayKeys[d]}`))
          .join(', ')
        return `${base} (${dayLabels})`
      }
      return base
    }
    case 'monthly':
      return formatFreqAtTime('monthly', parsed.timeOfDay, t)
    case 'cron':
      return parsed.cronExpression || t('frequencyType.cron')
    default:
      return t('frequencyType.daily')
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function formatFrequencyFromTime(
  freq: NonNullable<Schedule['trigger']['time']>,
  nextRunAt: number | null,
  t: TranslateFn
): string | null {
  switch (freq.type) {
    case 'once': {
      const ts = freq.executeAt ?? nextRunAt
      return ts ? formatOnceDate(ts, t) : t('frequencyType.once')
    }
    case 'interval':
      return formatInterval(freq.intervalMinutes ?? 0, t)
    case 'daily':
      return formatFreqAtTime('daily', freq.timeOfDay, t)
    case 'weekly':
      return formatFreqAtTime('weekly', freq.timeOfDay, t)
    case 'biweekly':
      return t('frequencyType.biweekly')
    case 'monthly':
      return formatFreqAtTime('monthly', undefined, t)
    case 'cron':
      return freq.cronExpression || t('frequencyType.cron')
    default:
      return null
  }
}
