// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StatusDot } from '../../../src/renderer/components/ui/StatusDot'

describe('StatusDot', () => {
  it('renders a span with rounded-full and the correct color class', () => {
    const { container } = render(<StatusDot status="active" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.tagName).toBe('SPAN')
    expect(dot.className).toContain('rounded-full')
    expect(dot.className).toContain('bg-green-500')
  })

  it('includes animation class for active status', () => {
    const { container } = render(<StatusDot status="active" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('animate-')
  })

  it('does not include animation class for non-active statuses', () => {
    const { container } = render(<StatusDot status="waiting" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).not.toContain('animate-')
  })

  it('applies xs size by default (h-1.5 w-1.5)', () => {
    const { container } = render(<StatusDot status="error" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('h-1.5')
    expect(dot.className).toContain('w-1.5')
  })

  it('applies sm size (h-2 w-2)', () => {
    const { container } = render(<StatusDot status="error" size="sm" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('h-2')
    expect(dot.className).toContain('w-2')
  })

  it('applies md size (h-2.5 w-2.5)', () => {
    const { container } = render(<StatusDot status="error" size="md" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('h-2.5')
    expect(dot.className).toContain('w-2.5')
  })

  it('sets aria-hidden="true" for accessibility', () => {
    const { container } = render(<StatusDot status="completed" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot).toHaveAttribute('aria-hidden', 'true')
  })

  it('merges custom className', () => {
    const { container } = render(<StatusDot status="active" className="shrink-0" />)
    const dot = container.firstElementChild as HTMLElement
    expect(dot.className).toContain('shrink-0')
  })
})
