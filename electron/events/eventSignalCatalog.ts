// SPDX-License-Identifier: Apache-2.0

import type { HookEventType, SessionStatus, WebhookEventKind } from '@shared/types'

export type EventSubscriptionBucket = 'complete' | 'error' | 'attention'

const TRANSITION_BUCKET_MAP: Partial<Record<SessionStatus, EventSubscriptionBucket>> = {
  completed: 'complete',
  error: 'error',
  waiting: 'attention',
}

const ENGINE_EVENT_BUCKET_MAP: Record<HookEventType, EventSubscriptionBucket> = {
  session_start: 'attention',
  session_stop: 'complete',
  session_end: 'complete',
  session_error: 'error',
  task_completed: 'complete',
  notification: 'attention',
  subagent_start: 'attention',
  subagent_stop: 'complete',
}

const TRANSITION_WEBHOOK_MAP: Partial<Record<SessionStatus, WebhookEventKind>> = {
  completed: 'session_complete',
  error: 'session_error',
  waiting: 'session_waiting',
}

const ENGINE_EVENT_WEBHOOK_MAP: Partial<Record<HookEventType, WebhookEventKind>> = {
  session_start: 'session_start',
  task_completed: 'task_completed',
  notification: 'notification',
}

export function bucketForTransitionStatus(
  status: SessionStatus,
): EventSubscriptionBucket | null {
  return TRANSITION_BUCKET_MAP[status] ?? null
}

export function bucketForEngineEventType(
  eventType: HookEventType,
): EventSubscriptionBucket {
  return ENGINE_EVENT_BUCKET_MAP[eventType]
}

export function webhookKindForTransitionStatus(
  status: SessionStatus,
): WebhookEventKind | null {
  return TRANSITION_WEBHOOK_MAP[status] ?? null
}

export function webhookKindForEngineEventType(
  eventType: HookEventType,
): WebhookEventKind | null {
  return ENGINE_EVENT_WEBHOOK_MAP[eventType] ?? null
}

