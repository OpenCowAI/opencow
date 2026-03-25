// SPDX-License-Identifier: Apache-2.0

import type { TaskFull } from '@shared/types'
export { groupTasksByStatus } from '@shared/taskGrouping'

const VALID_STATUSES: ReadonlySet<TaskFull['status']> = new Set([
  'pending',
  'in_progress',
  'completed'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Parses a JSON string into a TaskFull object.
 * Returns null if JSON is invalid or missing `id` or `subject`.
 */
export function parseTaskFile(content: string): TaskFull | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  const { id, subject } = parsed
  if (typeof id !== 'string' || typeof subject !== 'string') return null

  const rawStatus = parsed.status
  const status: TaskFull['status'] =
    typeof rawStatus === 'string' && VALID_STATUSES.has(rawStatus as TaskFull['status'])
      ? (rawStatus as TaskFull['status'])
      : 'pending'

  return {
    id,
    subject,
    description: typeof parsed.description === 'string' ? parsed.description : '',
    activeForm: typeof parsed.activeForm === 'string' ? parsed.activeForm : '',
    status,
    blocks: toStringArray(parsed.blocks),
    blockedBy: toStringArray(parsed.blockedBy)
  }
}

