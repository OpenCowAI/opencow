// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

let relay: ToolProgressRelay

beforeEach(() => {
  relay = new ToolProgressRelay()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToolProgressRelay', () => {
  // --- onChunk immediacy ----------------------------------------------------

  it('onChunk is called immediately when chunk emitted', () => {
    const onChunk = vi.fn()
    relay.register('tool-use-foo', { onChunk, onFlush: vi.fn() })
    relay.emit('tool-use-foo', 'hello')
    expect(onChunk).toHaveBeenCalledOnce()
    expect(onChunk).toHaveBeenCalledWith('hello')
  })

  it('does not throw when emitting to unregistered tool', () => {
    expect(() => relay.emit('tool-use-nonexistent', 'chunk')).not.toThrow()
  })

  // --- onFlush throttle semantics -------------------------------------------

  it('onFlush is NOT called immediately — waits for throttle window', () => {
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush })
    relay.emit('tool-use-foo', 'hello')
    expect(onFlush).not.toHaveBeenCalled()   // not yet 50ms, should not fire
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledOnce()
  })

  it('rapid emits: onChunk called each time, onFlush called once per throttle window', () => {
    const onChunk = vi.fn()
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk, onFlush })
    relay.emit('tool-use-foo', 'a')
    relay.emit('tool-use-foo', 'b')
    relay.emit('tool-use-foo', 'c')
    expect(onChunk).toHaveBeenCalledTimes(3)  // each chunk arrives immediately
    expect(onFlush).not.toHaveBeenCalled()    // still inside throttle window
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledOnce()    // window ends, flush once
  })

  it('new throttle window starts after previous window closes', () => {
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush })
    relay.emit('tool-use-foo', 'a')
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(1)  // first window ends
    relay.emit('tool-use-foo', 'b')         // second window starts
    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(2)  // second window ends
  })

  it('respects custom throttleMs', () => {
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush, throttleMs: 200 })
    relay.emit('tool-use-foo', 'hello')
    vi.advanceTimersByTime(100)
    expect(onFlush).not.toHaveBeenCalled()    // 100ms is not enough for 200ms window
    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledOnce()    // 200ms reached
  })

  it('routes all emits through a single registration key', () => {
    const onChunk = vi.fn()
    const onFlush = vi.fn()
    relay.register('tool-use-123', { onChunk, onFlush, throttleMs: 50 })

    relay.emit('tool-use-123', 'a')
    relay.emit('tool-use-123', 'b')
    expect(onChunk).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(50)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })

  // --- unregister semantics -------------------------------------------------

  it('unregister cancels pending timer and calls onFlush once (final flush)', () => {
    const onChunk = vi.fn()
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk, onFlush })
    relay.emit('tool-use-foo', 'chunk')
    // unregister before throttle window ends
    relay.unregister('tool-use-foo')
    expect(onFlush).toHaveBeenCalledOnce()  // final flush fires immediately
    // advance time: cancelled timer should not fire onFlush again
    vi.advanceTimersByTime(100)
    expect(onFlush).toHaveBeenCalledOnce()  // still only 1 call
  })

  it('unregister stops subsequent emits from being processed', () => {
    const onChunk = vi.fn()
    relay.register('tool-use-foo', { onChunk, onFlush: vi.fn() })
    relay.unregister('tool-use-foo')
    relay.emit('tool-use-foo', 'stale')
    expect(onChunk).not.toHaveBeenCalled()
  })

  it('unregister without prior emit triggers final flush immediately (no pending timer)', () => {
    const onFlush = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush })
    // no emit, unregister directly (fast-finishing tool, no chunks)
    relay.unregister('tool-use-foo')
    expect(onFlush).toHaveBeenCalledOnce()  // final flush still fires
  })

  it('unregister removes the registered key and ignores subsequent emits', () => {
    const onChunk = vi.fn()
    const onFlush = vi.fn()
    const onDone = vi.fn()
    relay.register('tool-use-456', { onChunk, onFlush, onDone, throttleMs: 50 })

    relay.emit('tool-use-456', 'chunk')
    relay.unregister('tool-use-456')
    expect(onDone).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenCalledOnce()

    relay.emit('tool-use-456', 'stale')
    expect(onChunk).toHaveBeenCalledTimes(1)
  })

  // --- onDone semantics -----------------------------------------------------
  // onDone is only called from unregister, never from the throttle timer.
  // Purpose: clear activeToolUseId so the card switches from streaming to done mode.

  it('onDone is called from unregister before onFlush', () => {
    const onFlush = vi.fn()
    const onDone  = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush, throttleMs: 50, onDone })
    relay.emit('tool-use-foo', 'chunk')
    relay.unregister('tool-use-foo')
    // unregister: onDone first (clears executing state), then onFlush (final dispatch includes "done" state)
    expect(onFlush).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledOnce()
    // onDone is called before onFlush so the final flush snapshot includes the "done" state
    const flushOrder = onFlush.mock.invocationCallOrder[0]
    const doneOrder  = onDone.mock.invocationCallOrder[0]
    expect(doneOrder).toBeLessThan(flushOrder)
  })

  it('onDone is NOT called from throttle timer — only from unregister', () => {
    const onDone = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush: vi.fn(), throttleMs: 50, onDone })
    relay.emit('tool-use-foo', 'chunk')
    // advance time so throttle timer fires onFlush
    vi.advanceTimersByTime(50)
    expect(onDone).not.toHaveBeenCalled()  // timer does not trigger onDone
    // only unregister triggers onDone
    relay.unregister('tool-use-foo')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('onDone is called even when registered without prior emit', () => {
    const onDone = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush: vi.fn(), throttleMs: 50, onDone })
    relay.unregister('tool-use-foo')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('clear does NOT call onDone', () => {
    const onDone = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush: vi.fn(), throttleMs: 50, onDone })
    relay.emit('tool-use-foo', 'chunk')
    relay.clear()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('re-register does not call onDone of overwritten entry', () => {
    const onDone1 = vi.fn()
    const onDone2 = vi.fn()
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush: vi.fn(), throttleMs: 50, onDone: onDone1 })
    // re-register (overwrite old entry) — old onDone should not fire
    relay.register('tool-use-foo', { onChunk: vi.fn(), onFlush: vi.fn(), throttleMs: 50, onDone: onDone2 })
    relay.unregister('tool-use-foo')
    expect(onDone1).not.toHaveBeenCalled()  // old entry's onDone not triggered
    expect(onDone2).toHaveBeenCalledOnce()  // new entry's onDone triggered
  })

  // --- clear semantics ------------------------------------------------------

  it('clear cancels all timers without flushing', () => {
    const onFlush1 = vi.fn()
    const onFlush2 = vi.fn()
    relay.register('tool-use-a', { onChunk: vi.fn(), onFlush: onFlush1 })
    relay.register('tool-use-b', { onChunk: vi.fn(), onFlush: onFlush2 })
    relay.emit('tool-use-a', 'x')
    relay.emit('tool-use-b', 'y')
    relay.clear()
    expect(onFlush1).not.toHaveBeenCalled()   // clear does not flush
    expect(onFlush2).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onFlush1).not.toHaveBeenCalled()   // cancelled timers do not fire
    expect(onFlush2).not.toHaveBeenCalled()
  })

  it('clear silences subsequent emits', () => {
    const onChunk = vi.fn()
    relay.register('tool-use-a', { onChunk, onFlush: vi.fn() })
    relay.clear()
    relay.emit('tool-use-a', 'stale')
    expect(onChunk).not.toHaveBeenCalled()
  })

  // --- re-register semantics ------------------------------------------------

  it('re-register overwrites previous entry and cancels old timer', () => {
    const first  = vi.fn()
    const flush1 = vi.fn()
    const second = vi.fn()
    const flush2 = vi.fn()
    relay.register('tool-use-foo', { onChunk: first, onFlush: flush1 })
    relay.emit('tool-use-foo', 'chunk1')
    // re-register within throttle window (old timer should be cancelled)
    relay.register('tool-use-foo', { onChunk: second, onFlush: flush2 })
    relay.emit('tool-use-foo', 'chunk2')
    vi.advanceTimersByTime(50)
    expect(first).toHaveBeenCalledOnce()   // only processed chunk1
    expect(second).toHaveBeenCalledOnce()  // only processed chunk2
    expect(flush1).not.toHaveBeenCalled()  // old timer cancelled, old flush not fired
    expect(flush2).toHaveBeenCalledOnce()  // new timer fires new flush
  })
})
