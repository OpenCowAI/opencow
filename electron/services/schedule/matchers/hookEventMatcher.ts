// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, TriggerMatcher } from '../../../../src/shared/types'

export class HookEventMatcher implements TriggerMatcher {
  readonly type = 'hook_event'

  matches(event: DataBusEvent, filter: Record<string, unknown>): boolean {
    if (event.type !== 'hooks:event') return false

    // Filter by event type
    if (filter.eventType) {
      return event.payload.eventType === filter.eventType
    }

    // Filter by raw event name
    if (filter.rawEventName && typeof filter.rawEventName === 'string') {
      return event.payload.rawEventName === filter.rawEventName
    }

    return true
  }
}
