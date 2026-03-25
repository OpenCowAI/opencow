// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MessageClassifier } from '../../../electron/services/messageClassifier'
import type { EngineEventClassificationContext } from '../../../electron/services/messageClassifier'
import type { EngineEventEnvelope, InboxNavigationTarget } from '../../../src/shared/types'

function makeEngineEvent(overrides: Partial<EngineEventEnvelope> = {}): EngineEventEnvelope {
  const now = Date.now()
  return {
    eventId: 'hook:evt-1',
    sourceEventId: null,
    occurredAtMs: now,
    source: 'hook',
    timestamp: new Date(now).toISOString(),
    rawEventName: 'SessionStart',
    eventType: 'session_start',
    sessionRef: 'sess-1',
    payload: {},
    ...overrides,
  }
}

function makeNavigationTarget(overrides: Partial<InboxNavigationTarget> = {}): InboxNavigationTarget {
  return {
    kind: 'session',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    ...overrides,
  } as InboxNavigationTarget
}

function makeContext(
  overrides: Partial<EngineEventClassificationContext['session']> = {},
): EngineEventClassificationContext {
  return {
    session: {
      canonicalId: 'sess-1',
      projectId: 'proj-1',
      navigationTarget: makeNavigationTarget(),
      ...overrides,
    },
  }
}

describe('MessageClassifier', () => {
  let classifier: MessageClassifier

  beforeEach(() => {
    classifier = new MessageClassifier()
    vi.restoreAllMocks()
  })

  describe('engine event classification', () => {
    it('classifies lifecycle event as message', () => {
      const event = makeEngineEvent({ rawEventName: 'SessionStart', eventType: 'session_start' })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.category).toBe('hook_event')
      expect(result!.eventType).toBe('session_start')
    })

    it('passes through session_stop eventType', () => {
      const event = makeEngineEvent({ rawEventName: 'Stop', eventType: 'session_stop' })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.eventType).toBe('session_stop')
    })

    it('passes through session_error eventType', () => {
      const event = makeEngineEvent({ rawEventName: 'PostToolUseFailure', eventType: 'session_error' })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.eventType).toBe('session_error')
    })

    it('passes through task_completed eventType', () => {
      const event = makeEngineEvent({ rawEventName: 'TaskCompleted', eventType: 'task_completed' })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.eventType).toBe('task_completed')
    })

    it('passes through notification eventType', () => {
      const event = makeEngineEvent({ rawEventName: 'Notification', eventType: 'notification' })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.eventType).toBe('notification')
    })
  })

  describe('context population', () => {
    it('keeps projectId from explicit context', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(event, makeContext({ projectId: 'my-project' }))
      expect(result).not.toBeNull()
      expect(result!.projectId).toBe('my-project')
    })

    it('derives projectId from issue navigation target when context.projectId is null', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({
          projectId: null,
          navigationTarget: { kind: 'issue', projectId: 'proj-issue', issueId: 'issue-1' },
        }),
      )
      expect(result).not.toBeNull()
      expect(result!.projectId).toBe('proj-issue')
    })

    it('keeps projectId null for schedule navigation target', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({
          projectId: null,
          navigationTarget: { kind: 'schedule', scheduleId: 'sch-1' },
        }),
      )
      expect(result).not.toBeNull()
      expect(result!.projectId).toBeNull()
    })

    it('builds default session navigation target from projectId when navigationTarget is null', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({ projectId: 'resolved-proj', navigationTarget: null }),
      )
      expect(result).not.toBeNull()
      expect(result!.projectId).toBe('resolved-proj')
      expect(result!.navigationTarget).toEqual({
        kind: 'session',
        projectId: 'resolved-proj',
        sessionId: 'sess-1',
      })
    })

    it('returns null when neither projectId nor navigationTarget is available', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({ projectId: null, navigationTarget: null }),
      )
      expect(result).toBeNull()
    })

    it('prefers explicit projectId over navigationTarget projectId', () => {
      const event = makeEngineEvent()
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({
          projectId: 'from-context',
          navigationTarget: { kind: 'session', projectId: 'from-target', sessionId: 'sess-1' },
        }),
      )
      expect(result).not.toBeNull()
      expect(result!.projectId).toBe('from-context')
    })

    it('copies rawPayload from engine event', () => {
      const payload = { tool: 'bash', exitCode: 1 }
      const event = makeEngineEvent({ eventId: 'hook:payload-1', payload })
      const result = classifier.classifyEngineEvent(event, makeContext())
      expect(result).not.toBeNull()
      expect(result!.rawPayload).toEqual(
        expect.objectContaining({
          tool: 'bash',
          exitCode: 1,
          _engineEvent: expect.objectContaining({
            eventId: 'hook:payload-1',
            source: 'hook',
            sourceEventId: null,
            dedupKey: expect.any(String),
          }),
        }),
      )
    })

    it('uses canonicalSessionId for stored message sessionId', () => {
      const event = makeEngineEvent({ sessionRef: 'engine-ref-1' })
      const result = classifier.classifyEngineEvent(
        event,
        makeContext({ canonicalId: 'managed-session-1' }),
      )
      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('managed-session-1')
    })
  })

  describe('deterministic identity', () => {
    it('returns a stable message id for identical semantic events', () => {
      const event = makeEngineEvent({
        eventId: 'hook:evt-stable',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
      })
      const first = classifier.classifyEngineEvent(event, makeContext({ canonicalId: 'sess-1' }))
      const second = classifier.classifyEngineEvent(event, makeContext({ canonicalId: 'sess-1' }))
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first!.id).toBe(second!.id)
    })

    it('same semantics with different event occurrence ids generate different message ids', () => {
      const base = {
        rawEventName: 'Stop' as const,
        eventType: 'session_stop' as const,
        payload: { stopReason: 'completed' },
      }
      const first = classifier.classifyEngineEvent(
        makeEngineEvent({ ...base, eventId: 'managed:idle:1' }),
        makeContext(),
      )
      const second = classifier.classifyEngineEvent(
        makeEngineEvent({ ...base, eventId: 'managed:idle:2' }),
        makeContext(),
      )
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first!.id).not.toBe(second!.id)
    })

    it('different canonical sessions produce different message ids', () => {
      const event = makeEngineEvent({
        eventId: 'hook:evt-cross-session',
        rawEventName: 'SessionStart',
      })
      const first = classifier.classifyEngineEvent(
        event,
        makeContext({
          canonicalId: 'sess-1',
          navigationTarget: { kind: 'session', projectId: 'proj-1', sessionId: 'sess-1' },
        }),
      )
      const second = classifier.classifyEngineEvent(
        event,
        makeContext({
          canonicalId: 'sess-2',
          navigationTarget: { kind: 'session', projectId: 'proj-1', sessionId: 'sess-2' },
        }),
      )
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first!.id).not.toBe(second!.id)
    })

    it('same session but different event semantics produce different ids', () => {
      const event1 = makeEngineEvent({
        eventId: 'hook:evt-semantic-1',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
      })
      const event2 = makeEngineEvent({
        eventId: 'hook:evt-semantic-2',
        rawEventName: 'Stop',
        eventType: 'session_stop',
      })
      const first = classifier.classifyEngineEvent(event1, makeContext())
      const second = classifier.classifyEngineEvent(event2, makeContext())
      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
      expect(first!.id).not.toBe(second!.id)
    })

    it('pruneDedup() is a no-op and classification remains deterministic', () => {
      const event = makeEngineEvent({
        eventId: 'hook:evt-prune',
        rawEventName: 'SessionStart',
      })
      const before = classifier.classifyEngineEvent(event, makeContext())
      classifier.pruneDedup()
      const after = classifier.classifyEngineEvent(event, makeContext())
      expect(before).not.toBeNull()
      expect(after).not.toBeNull()
      expect(before!.id).toBe(after!.id)
    })
  })
})
