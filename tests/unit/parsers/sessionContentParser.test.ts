// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseSessionContentFromLines } from '../../../electron/parsers/sessionContentParser'

// Helper: construct JSONL lines
function jsonl(...entries: Record<string, unknown>[]): string[] {
  return entries.map((e) => JSON.stringify(e))
}

// Construct a user text message (marks the start of a Turn)
function userText(text: string, ts: string, uuid = 'u1'): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    uuid,
    message: { role: 'user', content: text }
  }
}

// Construct an assistant text response
function assistantText(text: string, ts: string, uuid = 'a1'): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: ts,
    uuid,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }]
    }
  }
}

// Construct an assistant tool_use entry
function assistantToolUse(
  toolName: string,
  input: Record<string, unknown>,
  ts: string,
  uuid = 'at1'
): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: ts,
    uuid,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `toolu_${uuid}`, name: toolName, input }]
    }
  }
}

// Construct a user tool_result (with duration)
function userToolResult(
  durationMs: number,
  sourceUuid: string,
  ts: string
): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    uuid: `tr_${sourceUuid}`,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `toolu_${sourceUuid}` }]
    },
    toolUseResult: { durationMs },
    sourceToolAssistantUUID: sourceUuid
  }
}

// Construct a noise entry
function progressEntry(ts: string): Record<string, unknown> {
  return {
    type: 'progress',
    timestamp: ts,
    uuid: 'prog1',
    data: { type: 'hook_progress', hookEvent: 'PostToolUse' }
  }
}

function metaUserEntry(ts: string): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    uuid: 'meta1',
    isMeta: true,
    message: { role: 'user', content: [{ type: 'text', text: 'system injection' }] }
  }
}

// Construct a user text message with array-format content (e.g. when images are attached)
function userTextArray(
  text: string,
  ts: string,
  uuid = 'u1',
  extraBlocks: Record<string, unknown>[] = []
): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    uuid,
    message: {
      role: 'user',
      content: [{ type: 'text', text }, ...extraBlocks]
    }
  }
}

describe('parseSessionContentFromLines', () => {
  it('extracts a single turn with user message and assistant response', () => {
    const lines = jsonl(
      userText('Fix the bug', '2026-01-01T10:00:00Z'),
      assistantText('I will fix the bug now.', '2026-01-01T10:00:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toBe('Fix the bug')
    expect(result.turns[0].assistantResponse).toBe('I will fix the bug now.')
    expect(result.turns[0].turnIndex).toBe(0)
  })

  it('extracts multiple turns', () => {
    const lines = jsonl(
      userText('Create a file', '2026-01-01T10:00:00Z', 'u1'),
      assistantText('Creating file...', '2026-01-01T10:00:05Z'),
      userText('Now test it', '2026-01-01T10:01:00Z', 'u2'),
      assistantText('Running tests...', '2026-01-01T10:01:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].userMessage).toBe('Create a file')
    expect(result.turns[1].userMessage).toBe('Now test it')
    expect(result.turns[1].turnIndex).toBe(1)
  })

  it('collects tool calls within a turn', () => {
    const lines = jsonl(
      userText('Read the config', '2026-01-01T10:00:00Z'),
      assistantToolUse('Read', { file_path: '/src/config.ts' }, '2026-01-01T10:00:02Z', 'at1'),
      userToolResult(15, 'at1', '2026-01-01T10:00:02Z'),
      assistantToolUse('Glob', { pattern: '*.test.ts' }, '2026-01-01T10:00:03Z', 'at2'),
      userToolResult(8, 'at2', '2026-01-01T10:00:03Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].toolCalls).toHaveLength(2)
    expect(result.turns[0].toolCalls[0]).toEqual({
      tool: 'Read',
      target: 'config.ts',
      durationMs: 15
    })
    expect(result.turns[0].toolCalls[1]).toEqual({
      tool: 'Glob',
      target: '*.test.ts',
      durationMs: 8
    })
  })

  it('extracts filesAffected from file-targeting tools', () => {
    const lines = jsonl(
      userText('Refactor', '2026-01-01T10:00:00Z'),
      assistantToolUse('Read', { file_path: '/src/a.ts' }, '2026-01-01T10:00:01Z', 'at1'),
      userToolResult(5, 'at1', '2026-01-01T10:00:01Z'),
      assistantToolUse('Edit', { file_path: '/src/a.ts', old_string: 'x', new_string: 'y' }, '2026-01-01T10:00:02Z', 'at2'),
      userToolResult(3, 'at2', '2026-01-01T10:00:02Z'),
      assistantToolUse('Write', { file_path: '/src/b.ts', content: '...' }, '2026-01-01T10:00:03Z', 'at3'),
      userToolResult(4, 'at3', '2026-01-01T10:00:03Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].filesAffected).toEqual(['/src/a.ts', '/src/b.ts'])
  })

  it('skips noise entries (progress, system, file-history-snapshot)', () => {
    const lines = jsonl(
      progressEntry('2026-01-01T10:00:00Z'),
      { type: 'system', timestamp: '2026-01-01T10:00:00Z', uuid: 'sys1', subtype: 'turn_duration' },
      { type: 'file-history-snapshot', timestamp: '2026-01-01T10:00:00Z', messageId: 'm1' },
      userText('Hello', '2026-01-01T10:00:01Z'),
      progressEntry('2026-01-01T10:00:02Z'),
      assistantText('Hi there', '2026-01-01T10:00:03Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toBe('Hello')
  })

  it('skips isMeta user entries', () => {
    const lines = jsonl(
      metaUserEntry('2026-01-01T10:00:00Z'),
      userText('Real message', '2026-01-01T10:00:01Z'),
      assistantText('Response', '2026-01-01T10:00:02Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toBe('Real message')
  })

  it('sanitizes user message with command tags', () => {
    const raw = '<command-message>yg.commit</command-message> <command-name>/yg.commit</command-name> <command-args>Fix the bug</command-args>'
    const lines = jsonl(
      userText(raw, '2026-01-01T10:00:00Z'),
      assistantText('Committing...', '2026-01-01T10:00:01Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].userMessage).toBe('Fix the bug')
  })

  it('skips user messages that sanitize to null (noise) and continues to next', () => {
    const lines = jsonl(
      userText('[Request interrupted by user for tool use]', '2026-01-01T10:00:00Z', 'u1'),
      userText('Real question', '2026-01-01T10:00:05Z', 'u2'),
      assistantText('Answer', '2026-01-01T10:00:06Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toBe('Real question')
  })

  it('computes correct stats', () => {
    const lines = jsonl(
      userText('Task 1', '2026-01-01T10:00:00Z', 'u1'),
      assistantToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T10:00:01Z', 'at1'),
      userToolResult(10, 'at1', '2026-01-01T10:00:01Z'),
      assistantToolUse('Write', { file_path: '/b.ts', content: '' }, '2026-01-01T10:00:02Z', 'at2'),
      userToolResult(5, 'at2', '2026-01-01T10:00:02Z'),
      userText('Task 2', '2026-01-01T10:05:00Z', 'u2'),
      assistantToolUse('Bash', { command: 'npm test' }, '2026-01-01T10:05:01Z', 'at3'),
      userToolResult(200, 'at3', '2026-01-01T10:05:03Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.stats.turnCount).toBe(2)
    expect(result.stats.toolCallCount).toBe(3)
    expect(result.stats.toolBreakdown).toEqual({ Read: 1, Write: 1, Bash: 1 })
    expect(result.stats.filesAffected).toEqual(['/a.ts', '/b.ts'])
    // durationMs = sum of each turn's active time, NOT wall clock span
    // Turn 1: 10:00:02 - 10:00:00 = 2000ms
    // Turn 2: 10:05:03 - 10:05:00 = 3000ms
    // Total = 5000ms (excludes 4m58s user idle between turns)
    expect(result.stats.durationMs).toBe(5000)
  })

  it('handles empty input', () => {
    const result = parseSessionContentFromLines([])
    expect(result.turns).toEqual([])
    expect(result.stats.turnCount).toBe(0)
  })

  it('handles malformed JSON lines gracefully', () => {
    const lines = [
      'not valid json',
      JSON.stringify(userText('Hello', '2026-01-01T10:00:00Z')),
      '{ broken',
      JSON.stringify(assistantText('Hi', '2026-01-01T10:00:01Z'))
    ]

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
  })

  it('extracts Bash command as target', () => {
    const lines = jsonl(
      userText('Run tests', '2026-01-01T10:00:00Z'),
      assistantToolUse('Bash', { command: 'npm test --coverage' }, '2026-01-01T10:00:01Z', 'at1'),
      userToolResult(500, 'at1', '2026-01-01T10:00:06Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].toolCalls[0].target).toBe('npm test --coverage')
  })

  it('extracts Grep pattern as target', () => {
    const lines = jsonl(
      userText('Find usage', '2026-01-01T10:00:00Z'),
      assistantToolUse('Grep', { pattern: 'function\\s+foo' }, '2026-01-01T10:00:01Z', 'at1'),
      userToolResult(20, 'at1', '2026-01-01T10:00:01Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].toolCalls[0].target).toBe('function\\s+foo')
  })

  it('sets correct startedAt and endedAt per turn', () => {
    const lines = jsonl(
      userText('Start', '2026-01-01T10:00:00Z'),
      assistantText('Working...', '2026-01-01T10:00:05Z'),
      assistantToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T10:00:10Z', 'at1'),
      userToolResult(5, 'at1', '2026-01-01T10:00:10Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].startedAt).toBe(new Date('2026-01-01T10:00:00Z').getTime())
    expect(result.turns[0].endedAt).toBe(new Date('2026-01-01T10:00:10Z').getTime())
  })

  it('recognizes user text message with array content (e.g. image attachment)', () => {
    const lines = jsonl(
      userTextArray('Refer to this UI design', '2026-01-01T10:00:00Z', 'u1', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }
      ]),
      assistantText('OK, I will refer to this design.', '2026-01-01T10:00:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toContain('Refer to this UI design')
    expect(result.turns[0].assistantResponse).toContain('OK, I will refer to this design')
    expect(result.turns[0].images).toHaveLength(1)
    expect(result.turns[0].images[0].dataUri).toBe('data:image/png;base64,abc')
    expect(result.turns[0].images[0].mediaType).toBe('image/png')
  })

  it('handles mixed string and array content user messages across turns', () => {
    const lines = jsonl(
      userText('First turn (string)', '2026-01-01T10:00:00Z', 'u1'),
      assistantText('Response 1', '2026-01-01T10:00:05Z'),
      userTextArray('Second turn (array)', '2026-01-01T10:01:00Z', 'u2'),
      assistantText('Response 2', '2026-01-01T10:01:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].userMessage).toBe('First turn (string)')
    expect(result.turns[1].userMessage).toBe('Second turn (array)')
  })

  it('does not treat tool_result array as user text message', () => {
    const lines = jsonl(
      userText('Start', '2026-01-01T10:00:00Z'),
      assistantToolUse('Read', { file_path: '/a.ts' }, '2026-01-01T10:00:01Z', 'at1'),
      userToolResult(10, 'at1', '2026-01-01T10:00:02Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0].userMessage).toBe('Start')
  })

  it('truncates long assistant response', () => {
    const longText = 'a'.repeat(300)
    const lines = jsonl(
      userText('Hi', '2026-01-01T10:00:00Z'),
      assistantText(longText, '2026-01-01T10:00:01Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].assistantResponse.length).toBeLessThanOrEqual(200)
  })

  // === Image extraction tests ===

  it('extracts a single image with correct dataUri, mediaType, and sizeBytes', () => {
    // 12 base64 chars → 9 bytes raw
    const b64data = 'AAAAAAAAAAAA'
    const lines = jsonl(
      userTextArray('See this screenshot', '2026-01-01T10:00:00Z', 'u1', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64data } }
      ]),
      assistantText('Got it.', '2026-01-01T10:00:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].images).toHaveLength(1)
    const img = result.turns[0].images[0]
    expect(img.dataUri).toBe(`data:image/png;base64,${b64data}`)
    expect(img.mediaType).toBe('image/png')
    expect(img.sizeBytes).toBe(Math.floor((b64data.length * 3) / 4))
  })

  it('extracts multiple images from a single turn', () => {
    const lines = jsonl(
      userTextArray('Compare these two', '2026-01-01T10:00:00Z', 'u1', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } }
      ]),
      assistantText('Comparing...', '2026-01-01T10:00:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].images).toHaveLength(2)
    expect(result.turns[0].images[0].mediaType).toBe('image/png')
    expect(result.turns[0].images[1].mediaType).toBe('image/jpeg')
  })

  it('returns empty images array for plain text message', () => {
    const lines = jsonl(
      userText('No images here', '2026-01-01T10:00:00Z'),
      assistantText('OK', '2026-01-01T10:00:01Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].images).toEqual([])
  })

  it('skips image blocks with missing source or data', () => {
    const lines = jsonl(
      userTextArray('Broken images', '2026-01-01T10:00:00Z', 'u1', [
        { type: 'image' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'VALID' } }
      ]),
      assistantText('OK', '2026-01-01T10:00:05Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].images).toHaveLength(1)
    expect(result.turns[0].images[0].dataUri).toBe('data:image/png;base64,VALID')
  })

  it('calculates sizeBytes correctly for known base64 length', () => {
    // 100 base64 chars → floor(100 * 3/4) = 75 bytes
    const data = 'A'.repeat(100)
    const lines = jsonl(
      userTextArray('Size test', '2026-01-01T10:00:00Z', 'u1', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }
      ]),
      assistantText('OK', '2026-01-01T10:00:01Z')
    )

    const result = parseSessionContentFromLines(lines)
    expect(result.turns[0].images[0].sizeBytes).toBe(75)
  })
})
