// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { EngineEventEnvelope, EventSubscriptionSettings, StatusTransition } from '@shared/types'
import {
  allowsEngineEvent,
  allowsTransition,
  buildEventSubscriptionPolicy,
} from '../../../electron/events/eventSubscriptionPolicy'

const DEFAULT_PREFS: EventSubscriptionSettings = {
  enabled: true,
  onError: true,
  onComplete: true,
  onStatusChange: true,
}

function makeTransition(
  overrides: Partial<StatusTransition> = {},
): StatusTransition {
  return {
    sessionId: 'sess-1',
    sessionName: 'Session 1',
    previousStatus: 'active',
    newStatus: 'completed',
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeEngineEvent(
  overrides: Partial<EngineEventEnvelope> = {},
): EngineEventEnvelope {
  const now = Date.now()
  return {
    eventId: 'hook:evt-1',
    sourceEventId: null,
    occurredAtMs: now,
    source: 'hook',
    timestamp: new Date(now).toISOString(),
    rawEventName: 'TaskCompleted',
    eventType: 'task_completed',
    sessionRef: 'sess-1',
    payload: {},
    ...overrides,
  }
}

describe('eventSubscriptionPolicy', () => {
  it('builds policy from notification preferences', () => {
    const policy = buildEventSubscriptionPolicy({
      enabled: true,
      onError: false,
      onComplete: true,
      onStatusChange: false,
    })

    expect(policy).toEqual({
      enabled: true,
      buckets: {
        complete: true,
        error: false,
        attention: false,
      },
    })
  })

  it('blocks all transitions when notifications are globally disabled', () => {
    const policy = buildEventSubscriptionPolicy({ ...DEFAULT_PREFS, enabled: false })
    expect(allowsTransition(policy, makeTransition({ newStatus: 'completed' }))).toBe(false)
    expect(allowsTransition(policy, makeTransition({ newStatus: 'error' }))).toBe(false)
    expect(allowsTransition(policy, makeTransition({ newStatus: 'waiting' }))).toBe(false)
  })

  it('maps transition buckets to preference toggles', () => {
    const policy = buildEventSubscriptionPolicy({
      enabled: true,
      onError: false,
      onComplete: true,
      onStatusChange: false,
    })

    expect(allowsTransition(policy, makeTransition({ newStatus: 'completed' }))).toBe(true)
    expect(allowsTransition(policy, makeTransition({ newStatus: 'error' }))).toBe(false)
    expect(allowsTransition(policy, makeTransition({ newStatus: 'waiting' }))).toBe(false)
  })

  it('maps engine events to the same bucket semantics', () => {
    const policy = buildEventSubscriptionPolicy({
      enabled: true,
      onError: false,
      onComplete: true,
      onStatusChange: false,
    })

    expect(allowsEngineEvent(policy, makeEngineEvent({ eventType: 'task_completed' }))).toBe(true)
    expect(allowsEngineEvent(policy, makeEngineEvent({ eventType: 'session_stop' }))).toBe(true)
    expect(allowsEngineEvent(policy, makeEngineEvent({ eventType: 'session_error' }))).toBe(false)
    expect(allowsEngineEvent(policy, makeEngineEvent({ eventType: 'notification' }))).toBe(false)
  })
})
