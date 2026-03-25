// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { formatLogEntry } from '@shared/logger'
import type { LogEntry } from '@shared/logger'

describe('formatLogEntry', () => {
  const baseEntry: LogEntry = {
    timestamp: new Date('2026-02-25T14:30:05.123Z').getTime(),
    level: 'info',
    scope: 'main',
    message: 'Hello world',
  }

  it('formats a basic log entry with timestamp, level, and scope', () => {
    const line = formatLogEntry(baseEntry)

    // Timestamp is local time — verify structure, not exact value (TZ-dependent)
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}/)
    expect(line).toContain('[INFO ]')
    expect(line).toContain('[main]')
    expect(line).toContain('Hello world')
  })

  it('pads log levels to 5 characters for alignment', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const
    const expected = ['DEBUG', 'INFO ', 'WARN ', 'ERROR']

    levels.forEach((level, i) => {
      const line = formatLogEntry({ ...baseEntry, level })
      expect(line).toContain(`[${expected[i]}]`)
    })
  })

  it('includes scope in brackets', () => {
    const line = formatLogEntry({ ...baseEntry, scope: 'SessionOrchestrator' })
    expect(line).toContain('[SessionOrchestrator]')
  })

  it('handles child scope format', () => {
    const line = formatLogEntry({ ...baseEntry, scope: 'Orchestrator:health' })
    expect(line).toContain('[Orchestrator:health]')
  })

  it('formats context as JSON for objects', () => {
    const line = formatLogEntry({
      ...baseEntry,
      context: [{ sessions: 42 }],
    })
    expect(line).toContain('{"sessions":42}')
  })

  it('formats Error objects with message and stack', () => {
    const err = new Error('something broke')
    const line = formatLogEntry({
      ...baseEntry,
      level: 'error',
      context: [err],
    })
    expect(line).toContain('something broke')
    expect(line).toContain('Error: something broke')
  })

  it('formats serialized error objects from renderer IPC', () => {
    const serializedError = {
      __error: true,
      message: 'IPC error',
      stack: 'Error: IPC error\n    at renderer.ts:10',
    }
    const line = formatLogEntry({
      ...baseEntry,
      level: 'error',
      context: [serializedError],
    })
    expect(line).toContain('IPC error')
    expect(line).toContain('at renderer.ts:10')
  })

  it('formats string context as-is', () => {
    const line = formatLogEntry({
      ...baseEntry,
      context: ['migration-001'],
    })
    expect(line).toContain('migration-001')
  })

  it('formats multiple context items separated by space', () => {
    const line = formatLogEntry({
      ...baseEntry,
      context: ['file.ts', 42, { ok: true }],
    })
    expect(line).toContain('file.ts 42 {"ok":true}')
  })

  it('omits context portion when context is undefined', () => {
    const line = formatLogEntry({ ...baseEntry, context: undefined })
    expect(line).toMatch(/\[main\] Hello world$/)
  })

  it('omits context portion when context is empty array', () => {
    const line = formatLogEntry({ ...baseEntry, context: [] })
    expect(line).toMatch(/\[main\] Hello world$/)
  })

  it('handles empty message', () => {
    const line = formatLogEntry({ ...baseEntry, message: '' })
    expect(line).toContain('[main]')
    // No trailing space after scope
    expect(line).toMatch(/\[main\]$/)
  })

  it('handles circular reference in context gracefully', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    const line = formatLogEntry({
      ...baseEntry,
      context: [circular],
    })
    // Should not throw — falls back to String()
    expect(line).toContain('[main]')
  })
})
