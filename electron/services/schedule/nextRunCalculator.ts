// SPDX-License-Identifier: Apache-2.0

import type { ScheduleFrequency } from '../../../src/shared/types'
import { BiweeklyCalculator } from './biweeklyCalculator'

const biweeklyCalc = new BiweeklyCalculator()

/**
 * Calculate the next run timestamp for a given frequency configuration.
 * Returns null if the schedule should not run again (e.g., 'once' after first run).
 */
export function calculateNextRun(
  frequency: ScheduleFrequency,
  fromTimestamp: number = Date.now()
): number | null {
  switch (frequency.type) {
    case 'once':
      return null // One-shot — no next run after first execution

    case 'interval':
      return fromTimestamp + (frequency.intervalMinutes ?? 5) * 60_000

    case 'daily':
      return nextDailyRun(frequency, fromTimestamp)

    case 'weekly':
      return nextWeeklyRun(frequency, fromTimestamp)

    case 'biweekly':
      return nextBiweeklyRun(frequency, fromTimestamp)

    case 'monthly':
      return nextMonthlyRun(frequency, fromTimestamp)

    case 'cron':
      return nextCronRun(frequency, fromTimestamp)

    default:
      return null
  }
}

/**
 * Preview the next N run times for a given frequency.
 */
export function previewNextRuns(
  frequency: ScheduleFrequency,
  count: number,
  fromTimestamp: number = Date.now()
): number[] {
  const runs: number[] = []
  let current = fromTimestamp

  for (let i = 0; i < count && i < 20; i++) {
    const next = calculateNextRun(frequency, current)
    if (next === null) break
    runs.push(next)
    current = next
  }

  return runs
}

// === Internal helpers ===

function parseTimeOfDay(timeStr?: string): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 9, minutes: 0 } // Default 09:00
  const [h, m] = timeStr.split(':').map(Number)
  return { hours: h ?? 9, minutes: m ?? 0 }
}

function nextDailyRun(freq: ScheduleFrequency, from: number): number {
  const { hours, minutes } = parseTimeOfDay(freq.timeOfDay)
  const d = new Date(from)

  // Set to today's target time
  d.setHours(hours, minutes, 0, 0)

  // If already past today's time, move to tomorrow
  if (d.getTime() <= from) {
    d.setDate(d.getDate() + 1)
  }

  // Skip non-workdays if needed
  return skipNonWorkdays(d, freq)
}

function nextWeeklyRun(freq: ScheduleFrequency, from: number): number {
  const { hours, minutes } = parseTimeOfDay(freq.timeOfDay)
  const daysOfWeek = freq.daysOfWeek ?? [1] // Default Monday
  const d = new Date(from)

  // Try each day for the next 14 days
  for (let offset = 0; offset < 14; offset++) {
    const candidate = new Date(d)
    candidate.setDate(d.getDate() + offset)
    candidate.setHours(hours, minutes, 0, 0)

    if (candidate.getTime() <= from) continue

    const isoDay = candidate.getDay() === 0 ? 7 : candidate.getDay()
    if (daysOfWeek.includes(isoDay)) {
      return candidate.getTime()
    }
  }

  // Fallback: 7 days from now
  return from + 7 * 24 * 60 * 60 * 1000
}

function nextBiweeklyRun(freq: ScheduleFrequency, from: number): number {
  const { hours, minutes } = parseTimeOfDay(freq.timeOfDay)
  const config = freq.biweeklyConfig

  if (!config) return nextWeeklyRun(freq, from) // Fallback

  const d = new Date(from)

  // Scan next 21 days to find next workday
  for (let offset = 0; offset < 21; offset++) {
    const candidate = new Date(d)
    candidate.setDate(d.getDate() + offset)
    candidate.setHours(hours, minutes, 0, 0)

    if (candidate.getTime() <= from) continue

    if (biweeklyCalc.isWorkday(candidate, config)) {
      return candidate.getTime()
    }
  }

  // Fallback
  return from + 7 * 24 * 60 * 60 * 1000
}

function nextMonthlyRun(freq: ScheduleFrequency, from: number): number {
  const { hours, minutes } = parseTimeOfDay(freq.timeOfDay)
  const dayOfMonth = freq.dayOfMonth ?? 1
  const d = new Date(from)

  // Try this month
  const thisMonth = new Date(d.getFullYear(), d.getMonth(), dayOfMonth, hours, minutes, 0, 0)
  if (thisMonth.getTime() > from && thisMonth.getDate() === dayOfMonth) {
    return thisMonth.getTime()
  }

  // Next month
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, dayOfMonth, hours, minutes, 0, 0)
  // Handle months where dayOfMonth > days in month (e.g., 31st in Feb)
  if (nextMonth.getDate() !== dayOfMonth) {
    // Use last day of month instead
    nextMonth.setDate(0) // Goes to last day of previous month
    nextMonth.setHours(hours, minutes, 0, 0)
  }
  return nextMonth.getTime()
}

function nextCronRun(freq: ScheduleFrequency, from: number): number | null {
  const expr = freq.cronExpression
  if (!expr) return null

  // Simple cron parser for standard 5-field expressions:
  // minute hour day-of-month month day-of-week
  try {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return from + 60_000 // Fallback to 1 minute

    const d = new Date(from + 60_000) // Start from next minute
    d.setSeconds(0, 0)

    // Brute force: check each minute for next 48 hours
    const maxCheck = 48 * 60 // 48 hours in minutes
    for (let i = 0; i < maxCheck; i++) {
      if (matchesCron(d, parts)) {
        return d.getTime()
      }
      d.setMinutes(d.getMinutes() + 1)
    }

    return null // No match in next 48h
  } catch {
    return from + 60_000
  }
}

function matchesCron(date: Date, parts: string[]): boolean {
  const [minutePart, hourPart, domPart, monthPart, dowPart] = parts

  return (
    matchesCronField(date.getMinutes(), minutePart, 0, 59) &&
    matchesCronField(date.getHours(), hourPart, 0, 23) &&
    matchesCronField(date.getDate(), domPart, 1, 31) &&
    matchesCronField(date.getMonth() + 1, monthPart, 1, 12) &&
    matchesCronField(date.getDay(), dowPart, 0, 7) // 0 and 7 both = Sunday
  )
}

function matchesCronField(value: number, pattern: string, _min: number, _max: number): boolean {
  if (pattern === '*') return true

  // Handle lists: "1,3,5"
  if (pattern.includes(',')) {
    return pattern.split(',').some((p) => matchesCronField(value, p.trim(), _min, _max))
  }

  // Handle ranges: "1-5"
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number)
    return value >= start && value <= end
  }

  // Handle step: "*/5"
  if (pattern.startsWith('*/')) {
    const step = parseInt(pattern.slice(2), 10)
    return step > 0 && value % step === 0
  }

  // Literal number
  const num = parseInt(pattern, 10)
  if (isNaN(num)) return false

  // Special: day-of-week 7 = 0 (Sunday)
  if (_max === 7 && num === 7) return value === 0
  return value === num
}

function skipNonWorkdays(date: Date, freq: ScheduleFrequency): number {
  if (freq.workMode === 'all_days') return date.getTime()

  // Max 14 days forward search
  for (let i = 0; i < 14; i++) {
    const day = date.getDay()
    if (freq.workMode === 'weekdays') {
      if (day !== 0 && day !== 6) return date.getTime()
    } else if (freq.workMode === 'big_small_week' && freq.biweeklyConfig) {
      if (biweeklyCalc.isWorkday(date, freq.biweeklyConfig)) return date.getTime()
    }
    date.setDate(date.getDate() + 1)
  }

  return date.getTime()
}
