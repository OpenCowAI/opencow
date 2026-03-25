// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionState, SessionStatus } from '@shared/types'

/**
 * Canonical managed-runtime state -> lifecycle status mapping.
 *
 * Used by transition projection and normalized managed engine-event projection.
 */
export function mapManagedSessionStateToStatus(
  state: ManagedSessionState,
): SessionStatus {
  switch (state) {
    case 'creating':
    case 'streaming':
    case 'stopping':
      return 'active'
    case 'awaiting_input':
    case 'awaiting_question':
      return 'waiting'
    case 'idle':
    case 'stopped':
      return 'completed'
    case 'error':
      return 'error'
  }
}
