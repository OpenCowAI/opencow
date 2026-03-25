// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import type { Session, SessionStatus } from '@shared/types'

export type SessionStatusCounts = Record<SessionStatus, number>

/** Pure computation function — exported for direct testing without React hooks. */
export function computeSessionStatusCounts(sessions: Session[]): SessionStatusCounts {
  const counts: SessionStatusCounts = { active: 0, waiting: 0, completed: 0, error: 0 }
  for (const session of sessions) {
    counts[session.status]++
  }
  return counts
}

/** Memoized hook that computes session status counts in a single pass. */
export function useSessionStatusCounts(sessions: Session[]): SessionStatusCounts {
  return useMemo(() => computeSessionStatusCounts(sessions), [sessions])
}
