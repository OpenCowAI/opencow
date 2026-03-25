// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ManagedSessionInfo, StatusTransition } from '@shared/types'
import { SessionTransitionProjector, toTransitionStatus } from '../../../electron/app/sessionTransitionProjector'

function makeManagedInfo(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'ccb-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'creating',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    activeDurationMs: 0,
    activeStartedAt: Date.now(),
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    activity: null,
    error: null,
    executionContext: null,
    ...overrides,
  }
}

function singleTransition(transitions: StatusTransition[]): StatusTransition {
  expect(transitions).toHaveLength(1)
  return transitions[0]
}

describe('SessionTransitionProjector', () => {
  it('derives transitions from managed command events', () => {
    const projector = new SessionTransitionProjector({ now: () => 1_000 })
    const sessionId = 'ccb-m1'

    expect(
      projector.projectFromCommandEvent({
        type: 'command:session:created',
        payload: makeManagedInfo({ id: sessionId, state: 'creating', origin: { source: 'issue', issueId: 'ISSUE-1' } }),
      })
    ).toEqual([])

    const waiting = singleTransition(
      projector.projectFromCommandEvent({
        type: 'command:session:updated',
        payload: makeManagedInfo({ id: sessionId, state: 'awaiting_input', origin: { source: 'issue', issueId: 'ISSUE-1' } }),
      })
    )
    expect(waiting.sessionName).toBe('Issue ISSUE-1')
    expect(waiting.previousStatus).toBe('active')
    expect(waiting.newStatus).toBe('waiting')

    const completed = singleTransition(
      projector.projectFromCommandEvent({
        type: 'command:session:updated',
        payload: makeManagedInfo({ id: sessionId, state: 'idle', origin: { source: 'issue', issueId: 'ISSUE-1' } }),
      })
    )
    expect(completed.previousStatus).toBe('waiting')
    expect(completed.newStatus).toBe('completed')
  })

  it('filters hook transitions for managed sessions, but allows after delete', () => {
    const projector = new SessionTransitionProjector()
    const managedId = 'ccb-managed'
    const hookTransition: StatusTransition = {
      sessionId: managedId,
      sessionName: 'Legacy Name',
      previousStatus: 'active',
      newStatus: 'completed',
      timestamp: 1,
    }

    projector.projectFromCommandEvent({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: managedId, state: 'creating' }),
    })

    expect(projector.projectFromHookTransition(hookTransition)).toEqual([])

    projector.projectFromCommandEvent({
      type: 'command:session:deleted',
      payload: { sessionId: managedId },
    })

    expect(projector.projectFromHookTransition(hookTransition)).toEqual([hookTransition])
  })

  it('prunes stale cache entries', () => {
    let now = 10_000
    const projector = new SessionTransitionProjector({
      now: () => now,
      staleMs: 100,
      maxEntries: 100,
    })

    projector.projectFromCommandEvent({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: 'ccb-old', state: 'creating' }),
    })

    now = 10_200

    const oldHookTransition: StatusTransition = {
      sessionId: 'ccb-old',
      sessionName: 'Old Session',
      previousStatus: 'active',
      newStatus: 'completed',
      timestamp: now,
    }
    expect(projector.projectFromHookTransition(oldHookTransition)).toEqual([oldHookTransition])
  })
})

describe('toTransitionStatus', () => {
  it('maps managed states to transition statuses', () => {
    expect(toTransitionStatus('creating')).toBe('active')
    expect(toTransitionStatus('streaming')).toBe('active')
    expect(toTransitionStatus('awaiting_input')).toBe('waiting')
    expect(toTransitionStatus('awaiting_question')).toBe('waiting')
    expect(toTransitionStatus('idle')).toBe('completed')
    expect(toTransitionStatus('stopped')).toBe('completed')
    expect(toTransitionStatus('error')).toBe('error')
  })
})
