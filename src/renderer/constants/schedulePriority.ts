// SPDX-License-Identifier: Apache-2.0

/**
 * Schedule priority theme constants — colours and fallback labels
 * for priority display in schedule-related UI components.
 *
 * Mirrors the `ISSUE_PRIORITY_THEME` pattern in `issueStatus.ts` but uses
 * the Schedule domain's priority levels (`critical | high | normal | low`)
 * instead of Issue's (`urgent | high | medium | low`).
 *
 * @module
 */

import type { SchedulePriority } from '@shared/types'

// ─── Theme ──────────────────────────────────────────────────────────────────

export interface SchedulePriorityTheme {
  /** Fallback label when no i18n translation is available. */
  label: string
  /** Tailwind colour class for priority text / icon. */
  color: string
}

export const SCHEDULE_PRIORITY_THEME: Record<SchedulePriority, SchedulePriorityTheme> = {
  critical: { label: 'Critical', color: 'text-red-500' },
  high:     { label: 'High',     color: 'text-orange-500' },
  normal:   { label: 'Normal',   color: 'text-[hsl(var(--muted-foreground))]' },
  low:      { label: 'Low',      color: 'text-[hsl(var(--muted-foreground)/0.6)]' },
}
