// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { MessageQueue } from '../../../electron/command/messageQueue'

describe('MessageQueue', () => {
  it('yields pushed messages immediately when consumer is waiting', async () => {
    const queue = new MessageQueue()
    const iter = queue[Symbol.asyncIterator]()

    // Push before consuming — should buffer
    queue.push('hello')

    const result = await iter.next()
    expect(result.done).toBe(false)
    expect(result.value).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      session_id: ''
    })
  })

  it('blocks consumer until a message is pushed', async () => {
    const queue = new MessageQueue()
    const iter = queue[Symbol.asyncIterator]()

    let resolved = false
    const promise = iter.next().then((r) => {
      resolved = true
      return r
    })

    // Not yet resolved
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    // Push unblocks consumer
    queue.push('delayed')
    const result = await promise
    expect(resolved).toBe(true)
    expect(result.value.message.content).toBe('delayed')
  })

  it('multiple pushes are consumed in order', async () => {
    const queue = new MessageQueue()
    queue.push('first')
    queue.push('second')
    queue.push('third')

    const messages: string[] = []
    const iter = queue[Symbol.asyncIterator]()

    for (let i = 0; i < 3; i++) {
      const { value } = await iter.next()
      messages.push(value.message.content as string)
    }

    expect(messages).toEqual(['first', 'second', 'third'])
  })

  it('close() terminates the iterator', async () => {
    const queue = new MessageQueue()
    const iter = queue[Symbol.asyncIterator]()

    queue.push('before close')
    queue.close()

    const r1 = await iter.next()
    expect(r1.done).toBe(false) // buffered message still comes through

    const r2 = await iter.next()
    expect(r2.done).toBe(true)
  })

  it('consumer waiting when close() is called gets done=true', async () => {
    const queue = new MessageQueue()
    const iter = queue[Symbol.asyncIterator]()

    // Start waiting
    const promise = iter.next()

    // Close while waiting
    queue.close()

    const result = await promise
    expect(result.done).toBe(true)
  })

  it('converts slash_command blocks to CLI-compatible XML + expandedText for SDK', async () => {
    const queue = new MessageQueue()
    queue.push([
      { type: 'text', text: 'Please ' },
      {
        type: 'slash_command',
        name: 'yg.code.quality',
        category: 'command' as const,
        label: 'yg.code.quality',
        expandedText: 'Review the code quality.',
      },
      { type: 'text', text: ' for this file' },
    ])

    const iter = queue[Symbol.asyncIterator]()
    const { value } = await iter.next()

    // SDK receives: original text + CLI-compatible command XML + expanded text + trailing text
    const blocks = value.message.content as Array<{ type: string; text: string }>
    expect(blocks).toHaveLength(4)
    expect(blocks[0]).toEqual({ type: 'text', text: 'Please ' })
    // Command XML block contains <command-message> tag
    expect(blocks[1].type).toBe('text')
    expect(blocks[1].text).toContain('<command-message>')
    expect(blocks[1].text).toContain('yg.code.quality')
    expect(blocks[2]).toEqual({ type: 'text', text: 'Review the code quality.' })
    expect(blocks[3]).toEqual({ type: 'text', text: ' for this file' })
  })

  it('handles mixed slash_command and image blocks for SDK', async () => {
    const queue = new MessageQueue()
    queue.push([
      {
        type: 'slash_command',
        name: 'cmd',
        category: 'command' as const,
        label: 'cmd',
        expandedText: 'Expanded body',
      },
      { type: 'image', mediaType: 'image/png', data: 'base64data', sizeBytes: 100 },
    ])

    const iter = queue[Symbol.asyncIterator]()
    const { value } = await iter.next()

    const blocks = value.message.content as Array<{ type: string; text?: string; source?: unknown }>
    expect(blocks).toHaveLength(3)
    // First block: CLI-compatible command XML
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('<command-message>')
    // Second block: expanded text
    expect(blocks[1]).toEqual({ type: 'text', text: 'Expanded body' })
    // Third block: image
    expect(blocks[2]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } })
  })
})
