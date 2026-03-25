// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { EXIT_DURATION, useDialogState } from '../../../src/renderer/hooks/useModalAnimation'

describe('useDialogState', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--modal-exit-duration')
    vi.useRealTimers()
  })

  it('keeps dialog data available until exit animation completes', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDialogState<{ id: string }>())

    act(() => {
      result.current.show({ id: 'first' })
    })
    expect(result.current.open).toBe(true)
    expect(result.current.data).toEqual({ id: 'first' })

    act(() => {
      result.current.close()
    })
    expect(result.current.open).toBe(false)
    expect(result.current.data).toEqual({ id: 'first' })

    act(() => {
      vi.advanceTimersByTime(EXIT_DURATION + 9)
    })
    expect(result.current.data).toEqual({ id: 'first' })

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.data).toBeNull()
  })

  it('cancels pending cleanup when dialog reopens quickly', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDialogState<{ id: string }>())

    act(() => {
      result.current.show({ id: 'first' })
      result.current.close()
      vi.advanceTimersByTime(EXIT_DURATION / 2)
      result.current.show({ id: 'second' })
      vi.advanceTimersByTime(EXIT_DURATION + 20)
    })

    expect(result.current.open).toBe(true)
    expect(result.current.data).toEqual({ id: 'second' })
  })

  it('respects css variable driven modal exit duration', () => {
    vi.useFakeTimers()
    document.documentElement.style.setProperty('--modal-exit-duration', '220ms')
    const { result } = renderHook(() => useDialogState<{ id: string }>())

    act(() => {
      result.current.show({ id: 'first' })
      result.current.close()
      vi.advanceTimersByTime(EXIT_DURATION + 20)
    })
    expect(result.current.data).toEqual({ id: 'first' })

    act(() => {
      vi.advanceTimersByTime(220 - EXIT_DURATION)
      vi.advanceTimersByTime(10)
    })
    expect(result.current.data).toBeNull()
  })
})
