// SPDX-License-Identifier: Apache-2.0

import type { SessionStatus } from '@shared/types'

export interface SessionStatusTheme {
  /** Display label, e.g. "Active", "Done" */
  label: string
  /** Tailwind bg-* class for the indicator dot */
  dotColor: string
  /** Optional Tailwind animation class for the dot */
  dotAnimation?: string
  /** Badge component variant name */
  badgeVariant: 'active' | 'waiting' | 'completed' | 'error' | 'secondary'
  /** Tailwind bg-* class for the progress bar fill */
  progressColor: string
}

export const SESSION_STATUS_THEME: Record<SessionStatus, SessionStatusTheme> = {
  active: {
    label: 'Active',
    dotColor: 'bg-green-500',
    dotAnimation: 'animate-[pulse-breathe_2s_ease-in-out_infinite]',
    badgeVariant: 'active',
    progressColor: 'bg-green-500'
  },
  waiting: {
    label: 'Waiting',
    dotColor: 'bg-yellow-500',
    badgeVariant: 'waiting',
    progressColor: 'bg-yellow-500'
  },
  completed: {
    label: 'Done',
    dotColor: 'bg-gray-400',
    badgeVariant: 'completed',
    progressColor: 'bg-gray-400'
  },
  error: {
    label: 'Error',
    dotColor: 'bg-red-500',
    badgeVariant: 'error',
    progressColor: 'bg-red-500'
  }
}

/** Ordered list of all session statuses — useful for iterating in UI (e.g. legend, status bar). */
export const SESSION_STATUSES: SessionStatus[] = ['active', 'waiting', 'completed', 'error']
