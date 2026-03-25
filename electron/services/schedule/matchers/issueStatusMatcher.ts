// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, TriggerMatcher } from '../../../../src/shared/types'

export class IssueStatusMatcher implements TriggerMatcher {
  readonly type = 'issue_status'

  matches(event: DataBusEvent, filter: Record<string, unknown>): boolean {
    if (event.type !== 'issue:status_changed') return false

    // Filter by target status
    if (filter.targetStatus) {
      return event.payload.newStatus === filter.targetStatus
    }

    // Filter by from -> to transition
    if (filter.fromStatus && filter.toStatus) {
      return (
        event.payload.oldStatus === filter.fromStatus &&
        event.payload.newStatus === filter.toStatus
      )
    }

    return true
  }
}
