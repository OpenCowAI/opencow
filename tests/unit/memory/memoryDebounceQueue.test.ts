// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryDebounceQueue } from '../../../electron/memory/memoryDebounceQueue'
import type { InteractionEvent } from '../../../electron/memory/types'

function makeEvent(overrides: Partial<InteractionEvent> = {}): InteractionEvent {
  return {
    type: 'session',
    projectId: 'proj-1',
    sessionId: 'sess-1',
    content: 'User said something interesting about preferences',
    metadata: {},
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('MemoryDebounceQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should flush after debounce timeout', () => {
    const queue = new MemoryDebounceQueue(() => 1000)
    const onFlush = vi.fn()
    queue.addFlushListener(onFlush)

    queue.enqueue(makeEvent())

    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)

    queue.dispose()
  })

  it('should merge events with same key', () => {
    const queue = new MemoryDebounceQueue(() => 1000)
    const onFlush = vi.fn()
    queue.addFlushListener(onFlush)

    queue.enqueue(makeEvent({ content: 'first' }))
    vi.advanceTimersByTime(500)
    queue.enqueue(makeEvent({ content: 'second' }))

    // Timer was reset, so after 500ms total it shouldn't have flushed
    vi.advanceTimersByTime(500)
    expect(onFlush).not.toHaveBeenCalled()

    // After another 500ms (total 1000ms from last enqueue), it should flush
    vi.advanceTimersByTime(500)
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Merged content
    const flushedEvent = onFlush.mock.calls[0][0] as InteractionEvent
    expect(flushedEvent.content).toContain('first')
    expect(flushedEvent.content).toContain('second')
    expect(flushedEvent.content).toContain('---')

    queue.dispose()
  })

  it('should flush different keys independently', () => {
    const queue = new MemoryDebounceQueue(() => 1000)
    const onFlush = vi.fn()
    queue.addFlushListener(onFlush)

    queue.enqueue(makeEvent({ projectId: 'proj-1' }))
    queue.enqueue(makeEvent({ projectId: 'proj-2' }))

    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(2)

    queue.dispose()
  })

  it('should drop oldest events when queue exceeds max depth', () => {
    const queue = new MemoryDebounceQueue(() => 1000)
    const onFlush = vi.fn()
    queue.addFlushListener(onFlush)

    // Enqueue 25 events (max depth is 20)
    for (let i = 0; i < 25; i++) {
      queue.enqueue(makeEvent({ content: `event-${i}` }))
    }

    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)

    // Should contain only the last events (max batch size = 5)
    const flushedEvent = onFlush.mock.calls[0][0] as InteractionEvent
    expect(flushedEvent.content).toContain('event-24')

    queue.dispose()
  })

  it('should not flush after dispose', () => {
    const queue = new MemoryDebounceQueue(() => 1000)
    const onFlush = vi.fn()
    queue.addFlushListener(onFlush)

    queue.enqueue(makeEvent())
    queue.dispose()

    vi.advanceTimersByTime(2000)
    expect(onFlush).not.toHaveBeenCalled()
  })
})
