// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, TriggerMatcher } from '../../../../src/shared/types'

export class SessionIdleMatcher implements TriggerMatcher {
  readonly type = 'session_idle'

  matches(event: DataBusEvent, filter: Record<string, unknown>): boolean {
    if (event.type !== 'command:session:idle') return false

    // Optional: filter by stopReason
    if (filter.stopReason) {
      return event.payload.stopReason === filter.stopReason
    }

    return true
  }
}
