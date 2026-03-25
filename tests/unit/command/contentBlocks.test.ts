// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  normalizeContentBlocks,
  normalizeToolResultContent,
  ensureThinkingBlocksFirst,
  type SDKContentBlock
} from '../../../electron/command/contentBlocks'
import type { ContentBlock } from '../../../src/shared/types'

describe('normalizeToolResultContent', () => {
  it('returns string content as-is', () => {
    expect(normalizeToolResultContent('hello world')).toBe('hello world')
  })

  it('returns empty string for undefined', () => {
    expect(normalizeToolResultContent(undefined)).toBe('')
  })

  it('extracts text from array content', () => {
    const content = [
      { type: 'text', text: 'line 1' },
      { type: 'text', text: 'line 2' }
    ]
    expect(normalizeToolResultContent(content)).toBe('line 1line 2')
  })

  it('omits image blocks (they are extracted as standalone ImageBlocks)', () => {
    const content = [
      { type: 'text', text: 'before ' },
      { type: 'image', source: { type: 'base64', data: 'abc' } },
      { type: 'text', text: ' after' }
    ]
    expect(normalizeToolResultContent(content)).toBe('before  after')
  })

  it('handles empty array', () => {
    expect(normalizeToolResultContent([])).toBe('')
  })

  it('handles array with unknown types', () => {
    const content = [{ type: 'unknown' }]
    expect(normalizeToolResultContent(content)).toBe('')
  })
})

describe('normalizeContentBlocks', () => {
  it('converts text block', () => {
    const blocks: SDKContentBlock[] = [{ type: 'text', text: 'hello' }]
    expect(normalizeContentBlocks(blocks)).toEqual([
      { type: 'text', text: 'hello' }
    ])
  })

  it('skips empty text blocks', () => {
    const blocks: SDKContentBlock[] = [{ type: 'text', text: '' }]
    expect(normalizeContentBlocks(blocks)).toEqual([])
  })

  it('skips text blocks without text field', () => {
    const blocks: SDKContentBlock[] = [{ type: 'text' }]
    expect(normalizeContentBlocks(blocks)).toEqual([])
  })

  it('converts tool_use block', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls -la' }
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls -la' }
    }])
  })

  it('provides empty input for tool_use without input', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Read'
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Read',
      input: {}
    }])
  })

  it('preserves tool_use progress text', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls' },
      progress: 'line 1\nline 2\n',
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([{
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls' },
      progress: 'line 1\nline 2\n',
    }])
  })

  it('skips tool_use without id or name', () => {
    expect(normalizeContentBlocks([{ type: 'tool_use', name: 'Bash' }])).toEqual([])
    expect(normalizeContentBlocks([{ type: 'tool_use', id: 'tu-1' }])).toEqual([])
  })

  it('converts tool_result with string content', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_result',
      tool_use_id: 'tu-1',
      content: 'file contents here'
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([{
      type: 'tool_result',
      toolUseId: 'tu-1',
      content: 'file contents here',
      isError: undefined
    }])
  })

  it('converts tool_result with array content including image (images extracted as standalone blocks)', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_result',
      tool_use_id: 'tu-2',
      content: [
        { type: 'text', text: 'screenshot: ' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }
      ],
      is_error: false
    }]
    const result = normalizeContentBlocks(blocks)
    // tool_result text omits images (they are extracted as standalone ImageBlocks)
    expect(result[0]).toEqual({
      type: 'tool_result',
      toolUseId: 'tu-2',
      content: 'screenshot: ',
      isError: false
    })
    // Image is extracted as a standalone ImageBlock after the tool_result
    expect(result[1]).toEqual({
      type: 'image',
      mediaType: 'image/png',
      data: 'abc',
      sizeBytes: expect.any(Number)
    })
  })

  it('converts tool_result with error flag', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_result',
      tool_use_id: 'tu-3',
      content: 'Permission denied',
      is_error: true
    }]
    const result = normalizeContentBlocks(blocks)
    expect(result[0].type).toBe('tool_result')
    if (result[0].type === 'tool_result') {
      expect(result[0].isError).toBe(true)
    }
  })

  it('skips tool_result without tool_use_id', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'tool_result',
      content: 'orphaned result'
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([])
  })

  it('converts thinking block', () => {
    const blocks: SDKContentBlock[] = [{
      type: 'thinking',
      thinking: 'Let me analyze this...'
    }]
    expect(normalizeContentBlocks(blocks)).toEqual([{
      type: 'thinking',
      thinking: 'Let me analyze this...'
    }])
  })

  it('skips empty thinking blocks', () => {
    const blocks: SDKContentBlock[] = [{ type: 'thinking', thinking: '' }]
    expect(normalizeContentBlocks(blocks)).toEqual([])
  })

  it('skips unknown block types', () => {
    const blocks: SDKContentBlock[] = [
      { type: 'unknown_type' },
      { type: 'text', text: 'kept' }
    ]
    expect(normalizeContentBlocks(blocks)).toEqual([
      { type: 'text', text: 'kept' }
    ])
  })

  it('handles mixed block types preserving original order', () => {
    const blocks: SDKContentBlock[] = [
      { type: 'thinking', thinking: 'analyzing...' },
      { type: 'text', text: 'I will read the file.' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/tmp/a.ts' } },
      { type: 'tool_result', tool_use_id: 'tu-1', content: 'file contents' },
      { type: 'text', text: 'Done.' }
    ]
    const result = normalizeContentBlocks(blocks)
    expect(result).toHaveLength(5)
    expect(result.map((b) => b.type)).toEqual([
      'thinking', 'text', 'tool_use', 'tool_result', 'text'
    ])
  })

  it('does NOT reorder blocks (pure type normalization)', () => {
    // normalizeContentBlocks is a pure type-mapping function.
    // Block reordering is the responsibility of engine adapters.
    const blocks: SDKContentBlock[] = [
      { type: 'text', text: 'answer' },
      { type: 'thinking', thinking: 'reasoning' }
    ]
    const result = normalizeContentBlocks(blocks)
    expect(result.map((b) => b.type)).toEqual(['text', 'thinking'])
  })

  it('handles empty array', () => {
    expect(normalizeContentBlocks([])).toEqual([])
  })
})

describe('ensureThinkingBlocksFirst', () => {
  // Architectural invariant: Each assistant.partial/final event corresponds to
  // exactly one Claude API call, which produces at most ONE thinking block.
  // These tests verify the reordering for that real-world scenario.

  it('moves the thinking block before text when SDK emits them out of order', () => {
    // The primary bug scenario: Claude SDK streaming may emit [text, thinking]
    // instead of the correct [thinking, text].
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Here is my answer.' },
      { type: 'thinking', thinking: 'Let me think about this...' }
    ]
    const result = ensureThinkingBlocksFirst(blocks)
    expect(result).toHaveLength(2)
    expect(result.map((b) => b.type)).toEqual(['thinking', 'text'])
  })

  it('moves thinking before text+tool_use when SDK emits them out of order', () => {
    // Thinking block sandwiched between text and tool_use.
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'I will check.' },
      { type: 'thinking', thinking: 'reasoning...' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } }
    ]
    const result = ensureThinkingBlocksFirst(blocks)
    expect(result).toHaveLength(3)
    expect(result.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use'])
  })

  it('preserves relative order of non-thinking blocks after reorder', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'First.' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
      { type: 'thinking', thinking: 'late thinking' },
      { type: 'text', text: 'Second.' }
    ]
    const result = ensureThinkingBlocksFirst(blocks)
    // Non-thinking blocks preserve their original relative order.
    const nonThinking = result.filter((b) => b.type !== 'thinking')
    expect(nonThinking.map((b) => b.type)).toEqual(['text', 'tool_use', 'text'])
  })

  // --- Fast-path tests (no allocation, same reference returned) ---

  it('returns same reference when thinking is already first (fast path)', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'analyzing...' },
      { type: 'text', text: 'Result.' }
    ]
    const result = ensureThinkingBlocksFirst(blocks)
    expect(result).toBe(blocks)
    expect(result.map((b) => b.type)).toEqual(['thinking', 'text'])
  })

  it('returns same reference when no thinking blocks exist (fast path)', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: {} }
    ]
    expect(ensureThinkingBlocksFirst(blocks)).toBe(blocks)
  })

  it('returns same reference for empty array (fast path)', () => {
    const blocks: ContentBlock[] = []
    expect(ensureThinkingBlocksFirst(blocks)).toBe(blocks)
  })

  it('returns same reference for thinking-only array (fast path)', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'thought' }
    ]
    expect(ensureThinkingBlocksFirst(blocks)).toBe(blocks)
  })
})
