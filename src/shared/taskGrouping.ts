// SPDX-License-Identifier: Apache-2.0

import type { TaskFull, TaskGroup } from '@shared/types'

const STATUS_ORDER: readonly { status: TaskFull['status']; label: string }[] = [
  { status: 'in_progress', label: 'In Progress' },
  { status: 'pending', label: 'Pending' },
  { status: 'completed', label: 'Completed' }
]

/**
 * Groups tasks by status in order: in_progress -> pending -> completed.
 * Omits empty groups.
 */
export function groupTasksByStatus(tasks: TaskFull[]): TaskGroup[] {
  const groups: TaskGroup[] = []

  for (const { status, label } of STATUS_ORDER) {
    const matching = tasks.filter((t) => t.status === status)
    if (matching.length > 0) {
      groups.push({ status, label, tasks: matching })
    }
  }

  return groups
}
