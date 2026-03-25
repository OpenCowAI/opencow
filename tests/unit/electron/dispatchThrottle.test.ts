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
    vi.advanceTimersByTime(40)          // t=40
    throttle.scheduleMessage()          // t=40: does NOT restart timer
    vi.advanceTimersByTime(10)          // t=50: original timer fires
    expect(onFlushMessage).toHaveBeenCalledOnce()

    // If the timer were reset at t=40, it would fire at t=90, not t=50
    vi.advanceTimersByTime(40)          // t=90
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
})
