// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { StreamingMessageBuffer } from '../../../electron/command/streamingMessageBuffer'
import type { ManagedSessionMessage, ContentBlock, ToolUseBlock } from '../../../src/shared/types'

function makeAssistantMessage(overrides?: Partial<Extract<ManagedSessionMessage, { role: 'assistant' }>>): Extract<ManagedSessionMessage, { role: 'assistant' }> {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: [],
    timestamp: Date.now(),
    isStreaming: true,
    ...overrides,
  }
}

function makeToolUseBlock(id: string, name = 'Read'): ToolUseBlock {
  return { type: 'tool_use', id, name, input: {} }
}

describe('StreamingMessageBuffer', () => {
  it('starts inactive', () => {
    const buffer = new StreamingMessageBuffer()
    expect(buffer.isActive).toBe(false)
    expect(buffer.messageId).toBeNull()
    expect(buffer.getSnapshot()).toBeNull()
  })

  it('begin() activates with an assistant message', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage()
    buffer.begin(msg)
    expect(buffer.isActive).toBe(true)
    expect(buffer.messageId).toBe('msg-1')
  })

  it('begin() ignores non-assistant messages', () => {
    const buffer = new StreamingMessageBuffer()
    const userMsg: ManagedSessionMessage = { id: 'u-1', role: 'user', content: [], timestamp: Date.now() }
    buffer.begin(userMsg)
    expect(buffer.isActive).toBe(false)
  })

  it('updateBlocks() mutates the referenced message directly', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage()
    buffer.begin(msg)

    const newBlocks: ContentBlock[] = [{ type: 'text', text: 'hello' }]
    buffer.updateBlocks(newBlocks)

    // Direct mutation: the original msg object should have the new blocks
    expect(msg.content).toBe(newBlocks) // same reference
    expect(msg.isStreaming).toBe(true)
  })

  it('setActiveToolUseId() mutates the referenced message directly', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage()
    buffer.begin(msg)

    buffer.setActiveToolUseId('tool-1')
    expect(msg.activeToolUseId).toBe('tool-1')

    buffer.setActiveToolUseId(null)
    expect(msg.activeToolUseId).toBeNull()
  })

  it('appendToolProgress() appends to the correct tool block', () => {
    const buffer = new StreamingMessageBuffer()
    const tool = makeToolUseBlock('tool-1')
    const msg = makeAssistantMessage({ content: [tool] })
    buffer.begin(msg)

    buffer.appendToolProgress('tool-1', 'line 1\n')
    buffer.appendToolProgress('tool-1', 'line 2\n')

    expect(tool.progress).toBe('line 1\nline 2\n')
  })

  it('appendToolProgress() uses cache for consecutive same-id calls', () => {
    const buffer = new StreamingMessageBuffer()
    const tool1 = makeToolUseBlock('tool-1')
    const tool2 = makeToolUseBlock('tool-2')
    const msg = makeAssistantMessage({ content: [tool1, tool2] })
    buffer.begin(msg)

    // First call: cache miss → linear scan
    buffer.appendToolProgress('tool-2', 'a')
    expect(tool2.progress).toBe('a')

    // Second call: cache hit → O(1)
    buffer.appendToolProgress('tool-2', 'b')
    expect(tool2.progress).toBe('ab')

    // Different id: cache miss → linear scan, then cache update
    buffer.appendToolProgress('tool-1', 'x')
    expect(tool1.progress).toBe('x')

    // Back to tool-2: cache miss again
    buffer.appendToolProgress('tool-2', 'c')
    expect(tool2.progress).toBe('abc')
  })

  it('appendToolProgress() is no-op for unknown toolUseId', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage({ content: [makeToolUseBlock('tool-1')] })
    buffer.begin(msg)

    // Should not throw
    buffer.appendToolProgress('nonexistent', 'data')
    expect((msg.content[0] as ToolUseBlock).progress).toBeUndefined()
  })

  it('updateBlocks() invalidates tool block cache', () => {
    const buffer = new StreamingMessageBuffer()
    const tool = makeToolUseBlock('tool-1')
    const msg = makeAssistantMessage({ content: [tool] })
    buffer.begin(msg)

    buffer.appendToolProgress('tool-1', 'cached')
    expect(tool.progress).toBe('cached')

    // Replace blocks — cache should be invalidated
    const newTool = makeToolUseBlock('tool-1')
    buffer.updateBlocks([newTool])

    buffer.appendToolProgress('tool-1', 'fresh')
    expect(newTool.progress).toBe('fresh')
    // Old tool is untouched after replacement
    expect(tool.progress).toBe('cached')
  })

  it('getSnapshot() returns a shallow copy when no oversized progress', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage()
    buffer.begin(msg)

    const snapshot = buffer.getSnapshot()!
    expect(snapshot).not.toBe(msg) // different object
    expect(snapshot.id).toBe(msg.id)
    expect(snapshot.content).toBe(msg.content) // shallow: same content ref
  })

  it('getSnapshot() truncates oversized progress to IPC cap', () => {
    const buffer = new StreamingMessageBuffer()
    const tool = makeToolUseBlock('tool-1')
    const msg = makeAssistantMessage({ content: [{ type: 'text', text: 'hello' }, tool] })
    buffer.begin(msg)

    // Append progress exceeding 8000 chars
    const longProgress = 'x'.repeat(20_000)
    buffer.appendToolProgress('tool-1', longProgress)
    expect(tool.progress).toBe(longProgress) // internal state: full string

    const snapshot = buffer.getSnapshot()!
    // Snapshot should have truncated progress
    expect(snapshot.content).not.toBe(msg.content) // new content array
    const snapshotTool = snapshot.content[1] as ToolUseBlock
    expect(snapshotTool.progress!.length).toBe(8000)
    expect(snapshotTool.progress).toBe(longProgress.slice(-8000))
    // Text block should be the same reference (not tool_use, no trimming needed)
    expect(snapshot.content[0]).toBe(msg.content[0])
  })

  it('getSnapshot() preserves content reference when progress is under cap', () => {
    const buffer = new StreamingMessageBuffer()
    const tool = makeToolUseBlock('tool-1')
    const msg = makeAssistantMessage({ content: [tool] })
    buffer.begin(msg)

    buffer.appendToolProgress('tool-1', 'short progress')
    const snapshot = buffer.getSnapshot()!
    // Under cap: content reference should be the same (fast path)
    expect(snapshot.content).toBe(msg.content)
  })

  it('finalize() clears state and returns messageId', () => {
    const buffer = new StreamingMessageBuffer()
    const msg = makeAssistantMessage({ id: 'msg-42' })
    buffer.begin(msg)

    const id = buffer.finalize()
    expect(id).toBe('msg-42')
    expect(buffer.isActive).toBe(false)
    expect(buffer.messageId).toBeNull()
    expect(buffer.getSnapshot()).toBeNull()
  })

  it('finalize() returns null when inactive', () => {
    const buffer = new StreamingMessageBuffer()
    expect(buffer.finalize()).toBeNull()
  })

  it('clear() resets everything', () => {
    const buffer = new StreamingMessageBuffer()
    buffer.begin(makeAssistantMessage())
    buffer.clear()
    expect(buffer.isActive).toBe(false)
    expect(buffer.getSnapshot()).toBeNull()
  })

  it('all methods are no-op when inactive', () => {
    const buffer = new StreamingMessageBuffer()
    // These should not throw
    buffer.updateBlocks([{ type: 'text', text: 'x' }])
    buffer.setActiveToolUseId('tool-1')
    buffer.appendToolProgress('tool-1', 'data')
    expect(buffer.getSnapshot()).toBeNull()
  })
})
