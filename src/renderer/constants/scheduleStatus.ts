// SPDX-License-Identifier: Apache-2.0

import type { ScheduleStatus } from '@shared/types'

// ---------------------------------------------------------------------------
// Schedule Status Theme
// ---------------------------------------------------------------------------

export interface ScheduleStatusTheme {
  /** Display label, e.g. "Active", "Paused" */
  label: string
  /** Tailwind text-* class for icons and badges */
  color: string
}

/**
 * Single source of truth for Schedule status visual properties.
 *
 * Referenced by:
 *   - SearchResultItem (CommandPalette) → status badge + color
 *   - ScheduleView (if needed) → status indicators
 */
export const SCHEDULE_STATUS_THEME: Record<ScheduleStatus, ScheduleStatusTheme> = {
  active: { label: 'Active', color: 'text-green-500' },
  paused: { label: 'Paused', color: 'text-yellow-500' },
  completed: { label: 'Completed', color: 'text-[hsl(var(--muted-foreground))]' },
  error: { label: 'Error', color: 'text-red-500' },
}
