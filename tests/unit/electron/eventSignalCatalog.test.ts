// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  bucketForEngineEventType,
  bucketForTransitionStatus,
  webhookKindForEngineEventType,
  webhookKindForTransitionStatus,
} from '../../../electron/events/eventSignalCatalog'

describe('eventSignalCatalog', () => {
  it('maps transition statuses to subscription buckets', () => {
    expect(bucketForTransitionStatus('completed')).toBe('complete')
    expect(bucketForTransitionStatus('error')).toBe('error')
    expect(bucketForTransitionStatus('waiting')).toBe('attention')
    expect(bucketForTransitionStatus('active')).toBeNull()
  })

  it('maps engine event types to subscription buckets', () => {
    expect(bucketForEngineEventType('session_start')).toBe('attention')
    expect(bucketForEngineEventType('task_completed')).toBe('complete')
    expect(bucketForEngineEventType('session_error')).toBe('error')
  })

  it('maps transition statuses to webhook kinds', () => {
    expect(webhookKindForTransitionStatus('completed')).toBe('session_complete')
    expect(webhookKindForTransitionStatus('error')).toBe('session_error')
    expect(webhookKindForTransitionStatus('waiting')).toBe('session_waiting')
    expect(webhookKindForTransitionStatus('active')).toBeNull()
  })

  it('maps engine event types to webhook kinds', () => {
    expect(webhookKindForEngineEventType('session_start')).toBe('session_start')
    expect(webhookKindForEngineEventType('task_completed')).toBe('task_completed')
    expect(webhookKindForEngineEventType('notification')).toBe('notification')
    expect(webhookKindForEngineEventType('session_stop')).toBeNull()
  })
})

