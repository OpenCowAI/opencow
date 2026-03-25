// SPDX-License-Identifier: Apache-2.0

import type {
  EventSubscriptionSettings,
  EngineEventEnvelope,
  StatusTransition,
} from '@shared/types'
import {
  bucketForEngineEventType,
  bucketForTransitionStatus,
  type EventSubscriptionBucket,
} from './eventSignalCatalog'

export interface EventSubscriptionPolicy {
  enabled: boolean
  buckets: {
    complete: boolean
    error: boolean
    attention: boolean
  }
}

export function buildEventSubscriptionPolicy(
  preferences: EventSubscriptionSettings,
): EventSubscriptionPolicy {
  return {
    enabled: preferences.enabled,
    buckets: {
      complete: preferences.onComplete,
      error: preferences.onError,
      attention: preferences.onStatusChange,
    },
  }
}

export function allowsTransition(
  policy: EventSubscriptionPolicy,
  transition: StatusTransition,
): boolean {
  const bucket = bucketForTransitionStatus(transition.newStatus)
  if (!bucket) return false
  if (!policy.enabled) return false
  return policy.buckets[bucket]
}

export function allowsEngineEvent(
  policy: EventSubscriptionPolicy,
  event: EngineEventEnvelope,
): boolean {
  if (!policy.enabled) return false
  const bucket = bucketForEngineEventType(event.eventType)
  return policy.buckets[bucket]
}
