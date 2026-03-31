// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DispatchThrottle } from '../../../electron/command/dispatchThrottle'

let onFlushMessage: ReturnType<typeof vi.fn>
let onFlushSession: ReturnType<typeof vi.fn>
let throttle: DispatchThrottle

beforeEach(() => {
  vi.useFakeTimers()
  onFlushMessage = vi.fn()
  onFlushSession = vi.fn()
  throttle = new DispatchThrottle({ onFlushMessage, onFlushSession })
})

afterEach(() => {
  throttle.dispose()
  vi.useRealTimers()
})

describe('DispatchThrottle', () => {
  // --- scheduleMessage: trailing-edge coalescing ----------------------------

  it('scheduleMessage does NOT flush immediately', () => {
    throttle.scheduleMessage()
    expect(onFlushMessage).not.toHaveBeenCalled()
  })

  it('scheduleMessage flushes after the default 50ms window', () => {
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('rapid scheduleMessage calls: only one flush per window', () => {
    throttle.scheduleMessage()
    throttle.scheduleMessage()
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('second window starts fresh after first window fires', () => {
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()

    // Second window
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledTimes(2)
  })

  it('no flush if nothing is scheduled', () => {
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).not.toHaveBeenCalled()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  // --- scheduleSession: trailing-edge coalescing ----------------------------

  it('scheduleSession does NOT flush immediately', () => {
    throttle.scheduleSession()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  it('scheduleSession flushes after the 50ms window', () => {
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  it('rapid scheduleSession calls: only one flush per window', () => {
    throttle.scheduleSession()
    throttle.scheduleSession()
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  // --- Combined channels: single timer for both ----------------------------

  it('message + session scheduled together: both flush in same window', () => {
    throttle.scheduleMessage()
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  it('flush order: message before session', () => {
    const callOrder: string[] = []
    const orderedThrottle = new DispatchThrottle({
      onFlushMessage: () => callOrder.push('message'),
      onFlushSession: () => callOrder.push('session'),
    })

    orderedThrottle.scheduleMessage()
    orderedThrottle.scheduleSession()
    vi.advanceTimersByTime(50)

    expect(callOrder).toEqual(['message', 'session'])
    orderedThrottle.dispose()
  })

  it('only message scheduled: session flush is NOT called', () => {
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  it('only session scheduled: message flush is NOT called', () => {
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)
    expect(onFlushSession).toHaveBeenCalledOnce()
    expect(onFlushMessage).not.toHaveBeenCalled()
  })

  it('session scheduled during message window: both fire when window closes', () => {
    throttle.scheduleMessage()
    vi.advanceTimersByTime(25)             // halfway through window
    throttle.scheduleSession()             // piggybacks on existing timer
    vi.advanceTimersByTime(25)             // window closes
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  // --- flushNow: immediate synchronous flush --------------------------------

  it('flushNow dispatches pending message immediately', () => {
    throttle.scheduleMessage()
    throttle.flushNow()
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('flushNow dispatches pending session immediately', () => {
    throttle.scheduleSession()
    throttle.flushNow()
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  it('flushNow dispatches both channels immediately', () => {
    throttle.scheduleMessage()
    throttle.scheduleSession()
    throttle.flushNow()
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  it('flushNow cancels the pending timer (no double-flush)', () => {
    throttle.scheduleMessage()
    throttle.flushNow()
    vi.advanceTimersByTime(100)
    // Only the flushNow call, no timer-triggered flush
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('flushNow is a no-op when nothing is pending', () => {
    throttle.flushNow()
    expect(onFlushMessage).not.toHaveBeenCalled()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  it('flushNow followed by new schedule creates a fresh window', () => {
    throttle.scheduleMessage()
    throttle.flushNow()
    expect(onFlushMessage).toHaveBeenCalledOnce()

    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledTimes(2)
  })

  // --- dispose: cancel without flush ----------------------------------------

  it('dispose cancels pending timer without flushing', () => {
    throttle.scheduleMessage()
    throttle.scheduleSession()
    throttle.dispose()
    vi.advanceTimersByTime(100)
    expect(onFlushMessage).not.toHaveBeenCalled()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  it('dispose resets dirty flags (subsequent flushNow is a no-op)', () => {
    throttle.scheduleMessage()
    throttle.dispose()
    throttle.flushNow()
    expect(onFlushMessage).not.toHaveBeenCalled()
  })

  it('can schedule again after dispose', () => {
    throttle.scheduleMessage()
    throttle.dispose()
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  // --- Custom interval ------------------------------------------------------

  it('respects custom intervalMs', () => {
    const customThrottle = new DispatchThrottle({
      onFlushMessage,
      onFlushSession,
      intervalMs: 100,
    })

    customThrottle.scheduleMessage()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).not.toHaveBeenCalled()  // still within 100ms window

    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()   // 100ms elapsed

    customThrottle.dispose()
  })

  // --- Fixed-window semantics (timer not reset by subsequent events) ---------

  it('subsequent schedules do NOT reset the timer (fixed-window)', () => {
    throttle.scheduleMessage()          // t=0: starts 50ms timer
    vi.advanceTimersByTime(30)          // t=30
    throttle.scheduleMessage()          // t=30: does NOT restart timer
    vi.advanceTimersByTime(20)          // t=50: original timer fires
    expect(onFlushMessage).toHaveBeenCalledOnce()

    // If the timer were reset at t=30, it would fire at t=80, not t=50
    vi.advanceTimersByTime(30)          // t=80
    expect(onFlushMessage).toHaveBeenCalledOnce()  // no extra flush
  })

  // --- Edge cases -----------------------------------------------------------

  it('flushNow during timer callback is safe (no re-entrance)', () => {
    const reentrantThrottle = new DispatchThrottle({
      onFlushMessage: () => {
        onFlushMessage()
        // Simulate a flushNow being called from within the flush
        // (e.g., if the flush callback triggers a terminal event)
        reentrantThrottle.flushNow()
      },
      onFlushSession,
    })

    reentrantThrottle.scheduleMessage()
    vi.advanceTimersByTime(50)
    // onFlushMessage should be called once from the timer,
    // the re-entrant flushNow should be a no-op (nothing pending)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    reentrantThrottle.dispose()
  })

  it('rapid interleaved message + session schedules coalesce correctly', () => {
    for (let i = 0; i < 50; i++) {
      throttle.scheduleMessage()
      if (i % 5 === 0) throttle.scheduleSession()
    }
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).toHaveBeenCalledOnce()
  })

  it('multiple windows accumulate flush counts correctly', () => {
    // Window 1
    throttle.scheduleMessage()
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)

    // Window 2
    throttle.scheduleMessage()
    vi.advanceTimersByTime(50)

    // Window 3
    throttle.scheduleSession()
    vi.advanceTimersByTime(50)

    expect(onFlushMessage).toHaveBeenCalledTimes(2)   // window 1 + 2
    expect(onFlushSession).toHaveBeenCalledTimes(2)   // window 1 + 3
  })

  // --- scheduleProgress: separate 200ms timer ---------------------------------

  it('scheduleProgress does NOT flush immediately', () => {
    throttle.scheduleProgress()
    expect(onFlushMessage).not.toHaveBeenCalled()
  })

  it('scheduleProgress flushes after 200ms (default progress interval)', () => {
    throttle.scheduleProgress()
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).not.toHaveBeenCalled() // still within 200ms
    vi.advanceTimersByTime(150)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('scheduleProgress uses onFlushMessage callback', () => {
    throttle.scheduleProgress()
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    expect(onFlushSession).not.toHaveBeenCalled()
  })

  it('rapid scheduleProgress calls: only one flush per 200ms window', () => {
    for (let i = 0; i < 20; i++) {
      throttle.scheduleProgress()
    }
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('scheduleProgress piggybacks on pending message flush (50ms)', () => {
    throttle.scheduleMessage()
    throttle.scheduleProgress() // should be no-op since message pending
    vi.advanceTimersByTime(50)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    // No separate progress flush at 200ms
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('message flush clears progress pending flag', () => {
    throttle.scheduleProgress()
    vi.advanceTimersByTime(30)
    throttle.scheduleMessage() // starts 50ms message timer
    vi.advanceTimersByTime(50) // message timer fires — should also clear progress
    expect(onFlushMessage).toHaveBeenCalledOnce()
    // Progress timer still fires at 200ms from first scheduleProgress, but flag already cleared
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).toHaveBeenCalledOnce() // no extra flush
  })

  it('flushNow clears progress pending and cancels progress timer', () => {
    throttle.scheduleProgress()
    throttle.flushNow()
    expect(onFlushMessage).toHaveBeenCalledOnce()
    // No stale progress timer fire
    vi.advanceTimersByTime(300)
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })

  it('dispose cancels progress timer without flushing', () => {
    throttle.scheduleProgress()
    throttle.dispose()
    vi.advanceTimersByTime(300)
    expect(onFlushMessage).not.toHaveBeenCalled()
  })

  it('respects custom progressIntervalMs', () => {
    const customThrottle = new DispatchThrottle({
      onFlushMessage,
      onFlushSession,
      progressIntervalMs: 500,
    })
    customThrottle.scheduleProgress()
    vi.advanceTimersByTime(200)
    expect(onFlushMessage).not.toHaveBeenCalled() // 500ms not yet
    vi.advanceTimersByTime(300)
    expect(onFlushMessage).toHaveBeenCalledOnce()
    customThrottle.dispose()
  })

  it('progress and message use independent timers', () => {
    throttle.scheduleProgress() // 200ms timer
    vi.advanceTimersByTime(100)
    throttle.scheduleMessage()  // 50ms timer
    vi.advanceTimersByTime(50)  // message fires at t=150
    // _flush clears both message AND progress pending, cancels progress timer
    expect(onFlushMessage).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(100) // t=250 — progress timer would have fired but was cancelled
    expect(onFlushMessage).toHaveBeenCalledOnce()
  })
})
