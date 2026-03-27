// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { SessionInteractionAdapter } from '../../../electron/memory/adapters/sessionAdapter'

describe('SessionInteractionAdapter', () => {
  const adapter = new SessionInteractionAdapter()

  it('should have sourceType "session"', () => {
    expect(adapter.sourceType).toBe('session')
  })

  describe('shouldProcess', () => {
    it('should accept command:session:idle with sessionId', () => {
      expect(
        adapter.shouldProcess('command:session:idle', {
          sessionId: 'sess-1',
          stopReason: 'completed',
        }),
      ).toBe(true)
    })

    it('should accept command:session:stopped with sessionId', () => {
      expect(
        adapter.shouldProcess('command:session:stopped', {
          sessionId: 'sess-1',
          stopReason: 'completed',
        }),
      ).toBe(true)
    })

    it('should reject non-session events', () => {
      expect(adapter.shouldProcess('issues:invalidated', {})).toBe(false)
    })

    it('should reject error sessions', () => {
      expect(
        adapter.shouldProcess('command:session:idle', {
          sessionId: 'sess-1',
          stopReason: 'error',
        }),
      ).toBe(false)
    })

    it('should reject cancelled sessions', () => {
      expect(
        adapter.shouldProcess('command:session:idle', {
          sessionId: 'sess-1',
          stopReason: 'cancelled',
        }),
      ).toBe(false)
    })

    it('should reject sessions without sessionId', () => {
      expect(
        adapter.shouldProcess('command:session:idle', {
          stopReason: 'completed',
        }),
      ).toBe(false)
    })
  })

  describe('toInteractionEvent', () => {
    it('should create event with empty content placeholder', () => {
      const event = adapter.toInteractionEvent('command:session:idle', {
        sessionId: 'sess-1',
        origin: { source: 'agent', projectId: 'proj-1', projectName: 'MyProject' },
        stopReason: 'completed',
      })

      expect(event).not.toBeNull()
      expect(event!.type).toBe('session')
      expect(event!.sessionId).toBe('sess-1')
      expect(event!.projectId).toBe('proj-1')
      expect(event!.content).toBe('') // placeholder — resolved by MemoryService
    })

    it('should return null without sessionId', () => {
      const event = adapter.toInteractionEvent('command:session:idle', {
        stopReason: 'completed',
      })

      expect(event).toBeNull()
    })

    it('should extract metadata from origin', () => {
      const event = adapter.toInteractionEvent('command:session:idle', {
        sessionId: 'sess-1',
        origin: { source: 'issue', projectId: 'proj-2', projectName: 'TestProject' },
        stopReason: 'completed',
      })

      expect(event!.metadata.originSource).toBe('issue')
      expect(event!.metadata.projectName).toBe('TestProject')
    })
  })
})
