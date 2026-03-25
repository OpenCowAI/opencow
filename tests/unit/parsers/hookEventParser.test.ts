// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseHookLogLine, parseHookLogContent } from '../../../electron/parsers/hookEventParser'

function makeLine(hookEventName: string, extras: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: '2026-02-22T10:00:00Z',
    payload: {
      session_id: 'abc-123',
      hook_event_name: hookEventName,
      cwd: '/test',
      ...extras
    }
  })
}

describe('hookEventParser', () => {
  describe('parseHookLogLine', () => {
    it('parses valid hook event line with rawEventName', () => {
      const result = parseHookLogLine(makeLine('SessionStart'))

      expect(result).toEqual({
        timestamp: '2026-02-22T10:00:00Z',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
        sessionId: 'abc-123',
        sourceEventId: null,
        payload: {
          session_id: 'abc-123',
          hook_event_name: 'SessionStart',
          cwd: '/test'
        }
      })
    })

    it('extracts sourceEventId from raw uuid field', () => {
      const line = JSON.stringify({
        timestamp: '2026-02-22T10:00:00Z',
        uuid: 'hook-evt-001',
        payload: {
          session_id: 'abc-123',
          hook_event_name: 'SessionStart',
        }
      })

      const result = parseHookLogLine(line)
      expect(result?.sourceEventId).toBe('hook-evt-001')
    })

    it('normalizes SessionStart → session_start', () => {
      const result = parseHookLogLine(makeLine('SessionStart'))
      expect(result?.eventType).toBe('session_start')
    })

    it('normalizes Stop → session_stop', () => {
      const result = parseHookLogLine(makeLine('Stop'))
      expect(result?.eventType).toBe('session_stop')
    })

    it('normalizes PostToolUseFailure → session_error', () => {
      const result = parseHookLogLine(makeLine('PostToolUseFailure'))
      expect(result?.eventType).toBe('session_error')
    })

    it('normalizes TaskCompleted → task_completed', () => {
      const result = parseHookLogLine(makeLine('TaskCompleted'))
      expect(result?.eventType).toBe('task_completed')
    })

    it('normalizes Notification → notification', () => {
      const result = parseHookLogLine(makeLine('Notification'))
      expect(result?.eventType).toBe('notification')
    })

    it('sets eventType to null for PreToolUse (operational event)', () => {
      const result = parseHookLogLine(makeLine('PreToolUse'))
      expect(result?.rawEventName).toBe('PreToolUse')
      expect(result?.eventType).toBeNull()
    })

    it('sets eventType to null for PostToolUse (operational event)', () => {
      const result = parseHookLogLine(makeLine('PostToolUse'))
      expect(result?.rawEventName).toBe('PostToolUse')
      expect(result?.eventType).toBeNull()
    })

    it('handles camelCase field names', () => {
      const line = JSON.stringify({
        timestamp: '2026-02-22T10:00:00Z',
        payload: {
          sessionId: 'abc-123',
          hookEventName: 'Stop'
        }
      })
      const result = parseHookLogLine(line)
      expect(result?.sessionId).toBe('abc-123')
      expect(result?.rawEventName).toBe('Stop')
      expect(result?.eventType).toBe('session_stop')
    })

    it('returns null for empty line', () => {
      expect(parseHookLogLine('')).toBeNull()
      expect(parseHookLogLine('  ')).toBeNull()
    })

    it('returns null for invalid JSON', () => {
      expect(parseHookLogLine('not json')).toBeNull()
    })
  })

  describe('parseHookLogContent', () => {
    it('parses multi-line content', () => {
      const content = [makeLine('SessionStart'), makeLine('Stop')].join('\n')

      const result = parseHookLogContent(content)
      expect(result).toHaveLength(2)
      expect(result[0].rawEventName).toBe('SessionStart')
      expect(result[0].eventType).toBe('session_start')
      expect(result[1].rawEventName).toBe('Stop')
      expect(result[1].eventType).toBe('session_stop')
    })

    it('skips invalid lines', () => {
      const content = [makeLine('SessionStart'), 'invalid line', ''].join('\n')
      const result = parseHookLogContent(content)
      expect(result).toHaveLength(1)
    })
  })
})
