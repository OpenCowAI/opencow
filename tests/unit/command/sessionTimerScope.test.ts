// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionTimerScope } from '../../../electron/command/sessionTimerScope'

describe('SessionTimerScope', () => {
  let scope: SessionTimerScope

  beforeEach(() => {
    vi.useFakeTimers()
    scope = new SessionTimerScope()
  })

  afterEach(() => {
    scope.dispose()
    vi.useRealTimers()
  })

  it('set() executes callback after delay', () => {
    const cb = vi.fn()
    scope.set('a', cb, 100)

    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(cb).toHaveBeenCalledOnce()
  })

  it('set() with same key cancels previous timer', () => {
    const first = vi.fn()
    const second = vi.fn()

    scope.set('a', first, 100)
    scope.set('a', second, 100)

    vi.advanceTimersByTime(100)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('cancel() prevents callback from executing', () => {
    const cb = vi.fn()
    scope.set('a', cb, 100)
    scope.cancel('a')

    vi.advanceTimersByTime(200)
    expect(cb).not.toHaveBeenCalled()
  })

  it('cancel() is a no-op for unknown key', () => {
    // Should not throw
    expect(() => scope.cancel('nonexistent')).not.toThrow()
  })

  it('has() returns true for a pending timer', () => {
    scope.set('a', () => {}, 100)
    expect(scope.has('a')).toBe(true)
  })

  it('has() returns false for an unknown key', () => {
    expect(scope.has('missing')).toBe(false)
  })

  it('has() returns false after timer fires', () => {
    scope.set('a', () => {}, 100)
    vi.advanceTimersByTime(100)
    expect(scope.has('a')).toBe(false)
  })

  it('has() returns false after cancel()', () => {
    scope.set('a', () => {}, 100)
    scope.cancel('a')
    expect(scope.has('a')).toBe(false)
  })

  it('size reflects active timers', () => {
    expect(scope.size).toBe(0)

    scope.set('a', () => {}, 100)
    expect(scope.size).toBe(1)

    scope.set('b', () => {}, 200)
    expect(scope.size).toBe(2)

    vi.advanceTimersByTime(100)
    expect(scope.size).toBe(1)

    vi.advanceTimersByTime(100)
    expect(scope.size).toBe(0)
  })

  it('dispose() cancels all timers', () => {
    const cbA = vi.fn()
    const cbB = vi.fn()

    scope.set('a', cbA, 100)
    scope.set('b', cbB, 200)

    scope.dispose()
    vi.advanceTimersByTime(300)

    expect(cbA).not.toHaveBeenCalled()
    expect(cbB).not.toHaveBeenCalled()
    expect(scope.size).toBe(0)
  })

  it('dispose() is safe to call multiple times', () => {
    scope.set('a', () => {}, 100)
    scope.dispose()
    expect(() => scope.dispose()).not.toThrow()
    expect(scope.size).toBe(0)
  })
})
