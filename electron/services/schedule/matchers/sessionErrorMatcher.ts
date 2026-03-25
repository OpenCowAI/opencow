// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, TriggerMatcher } from '../../../../src/shared/types'

export class SessionErrorMatcher implements TriggerMatcher {
  readonly type = 'session_error'

  matches(event: DataBusEvent, filter: Record<string, unknown>): boolean {
    if (event.type !== 'command:session:error') return false

    // Optional: filter by error pattern
    if (filter.errorPattern && typeof filter.errorPattern === 'string') {
      return event.payload.error.includes(filter.errorPattern)
    }

    return true
  }
}
