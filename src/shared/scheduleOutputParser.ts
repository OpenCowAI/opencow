// SPDX-License-Identifier: Apache-2.0

/**
 * scheduleOutputParser — Extracts structured schedule data from AI conversation.
 *
 * The AI Schedule Creator outputs schedule data inside a `schedule-output` code
 * fence with YAML frontmatter (metadata) and a body (prompt template):
 *
 * ```schedule-output
 * ---
 * name: "Daily code review"
 * description: "Review recent git changes"
 * frequency: daily
 * timeOfDay: "09:00"
 * priority: normal
 * ---
 * Review all git changes from the past 24 hours and create issues
 * for anything notable. Focus on code quality and missing tests.
 * ```
 *
 * Design note: The **body** is the prompt template (the core content of a
 * schedule), not the description. This mirrors the Issue creator pattern where
 * the body carries the primary content (description for Issues, prompt for
 * Schedules). Short metadata like `description` stays in frontmatter.
 *
 * V1 scope: Time-based triggers only. Event triggers are configured via UI.
 *
 * Uses the shared `codeFenceScanner` for fence detection, then applies
 * schedule-specific field mapping and conditional validation.
 *
 * @module
 */

import { scanLastFencedBlock, scanLastFencedBlockFromMessages } from './codeFenceScanner'
import type { FrequencyType, ManagedSessionMessage, SchedulePriority } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Frequency types exposed via AI creator (time-based subset of FrequencyType).
 * Derived from the domain type to guarantee compile-time safety — if FrequencyType
 * changes, this will break loudly rather than silently diverge.
 */
export type ScheduleFrequencyType = Extract<
  FrequencyType,
  'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'
>

/**
 * Priority levels — re-export from domain type.
 * Values are identical (critical | high | normal | low), so no subset needed.
 */
export type SchedulePriorityType = SchedulePriority

export interface ParsedScheduleOutput {
  /** Schedule name from frontmatter (required). */
  name: string
  /** Short description from frontmatter. */
  description: string
  /** Trigger frequency type. */
  frequency: ScheduleFrequencyType
  /** Time of day in "HH:MM" format (for daily/weekly/monthly). */
  timeOfDay?: string
  /** Interval in minutes (for interval frequency). */
  intervalMinutes?: number
  /** Days of week as 0-6 array, 0=Sun (for weekly). */
  daysOfWeek?: number[]
  /** Cron expression (for cron frequency). */
  cronExpression?: string
  /** ISO 8601 datetime string (for once frequency). */
  executeAt?: string
  /** Prompt template — the body content (core of the schedule). */
  prompt: string
  /** Schedule priority. */
  priority: SchedulePriorityType
  /** Optional project ID. */
  projectId?: string | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEDULE_FENCE_TAG = 'schedule-output' as const
const SCHEDULE_FENCE_TAGS: readonly string[] = [SCHEDULE_FENCE_TAG]

const VALID_FREQUENCIES: ReadonlySet<string> = new Set<ScheduleFrequencyType>([
  'once', 'interval', 'daily', 'weekly', 'monthly', 'cron'
])

const VALID_PRIORITIES: ReadonlySet<string> = new Set<SchedulePriorityType>([
  'critical', 'high', 'normal', 'low'
])

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFrequency(value: unknown): ScheduleFrequencyType {
  if (typeof value === 'string' && VALID_FREQUENCIES.has(value)) {
    return value as ScheduleFrequencyType
  }
  return 'daily' // sensible default
}

function parsePriority(value: unknown): SchedulePriorityType {
  if (typeof value === 'string' && VALID_PRIORITIES.has(value)) {
    return value as SchedulePriorityType
  }
  return 'normal'
}

function parseTimeOfDay(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return undefined
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  if (h > 23 || m > 59) return undefined
  return value
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = parseInt(value, 10)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function parseDaysOfWeek(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const days = value
      .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
    return days.length > 0 ? days : undefined
  }
  return undefined
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

// ─── Conditional validation & defaults ───────────────────────────────────────

/**
 * Validates required fields per frequency type and applies sensible defaults.
 * Returns null if a hard-required field is missing (once→executeAt, cron→cronExpression).
 */
function validateAndDefault(output: ParsedScheduleOutput): ParsedScheduleOutput | null {
  switch (output.frequency) {
    case 'once':
      if (!output.executeAt) return null // can't create one-time without a datetime
      break
    case 'interval':
      output.intervalMinutes ??= 60
      if (output.intervalMinutes <= 0) output.intervalMinutes = 60
      break
    case 'daily':
      output.timeOfDay ??= '09:00'
      break
    case 'weekly':
      output.timeOfDay ??= '09:00'
      output.daysOfWeek ??= [1, 2, 3, 4, 5] // weekdays
      break
    case 'monthly':
      output.timeOfDay ??= '09:00'
      break
    case 'cron':
      if (!output.cronExpression) return null // can't create cron without expression
      break
  }
  return output
}

// ─── Domain mapping ──────────────────────────────────────────────────────────

function mapToScheduleOutput(
  attributes: Record<string, unknown>,
  body: string
): ParsedScheduleOutput | null {
  const name = typeof attributes.name === 'string' ? attributes.name.trim() : ''
  if (!name) return null

  const prompt = body.trim()
  if (!prompt) return null

  const output: ParsedScheduleOutput = {
    name,
    description: typeof attributes.description === 'string' ? attributes.description.trim() : '',
    frequency: parseFrequency(attributes.frequency),
    timeOfDay: parseTimeOfDay(attributes.timeOfDay ?? attributes['time-of-day']),
    intervalMinutes: parseNumber(attributes.intervalMinutes ?? attributes['interval-minutes']),
    daysOfWeek: parseDaysOfWeek(attributes.daysOfWeek ?? attributes['days-of-week']),
    cronExpression: parseOptionalString(attributes.cronExpression ?? attributes['cron-expression']) ?? undefined,
    executeAt: parseOptionalString(attributes.executeAt ?? attributes['execute-at']) ?? undefined,
    prompt,
    priority: parsePriority(attributes.priority),
    projectId: parseOptionalString(attributes.projectId) ?? parseOptionalString(attributes['project-id']),
  }

  return validateAndDefault(output)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract a ParsedScheduleOutput from a single text block.
 * Returns null if no valid schedule-output fence is found or required fields are missing.
 *
 * When multiple output blocks exist, returns the **last** one.
 */
export function parseScheduleOutput(text: string): ParsedScheduleOutput | null {
  const scanned = scanLastFencedBlock(text, SCHEDULE_FENCE_TAGS)
  if (!scanned) return null
  return mapToScheduleOutput(scanned.attributes, scanned.body)
}

/**
 * Scan session messages in reverse order and extract the most recent
 * schedule-output from assistant messages.
 */
export function extractLatestScheduleOutput(
  messages: ManagedSessionMessage[]
): ParsedScheduleOutput | null {
  const scanned = scanLastFencedBlockFromMessages(messages, SCHEDULE_FENCE_TAGS)
  if (!scanned) return null
  return mapToScheduleOutput(scanned.attributes, scanned.body)
}
