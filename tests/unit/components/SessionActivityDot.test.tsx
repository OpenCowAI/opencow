// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SessionActivityDot } from '../../../src/renderer/components/ui/SessionActivityDot'
import type { ManagedSessionState } from '../../../src/shared/types'

describe('SessionActivityDot', () => {
  it('renders green pill badge for streaming', () => {
    render(<SessionActivityDot state="streaming" />)
    const badge = screen.getByRole('status')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('aria-label', 'Session running')
    expect(badge).toHaveTextContent('Running')
    expect(badge.className).toContain('bg-green-500/10')
  })

  it('renders nothing for awaiting_input (agent not actively working)', () => {
    const { container } = render(<SessionActivityDot state="awaiting_input" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders blue pill badge for creating', () => {
    render(<SessionActivityDot state="creating" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('aria-label', 'Session starting')
    expect(badge).toHaveTextContent('Starting')
    expect(badge.className).toContain('bg-blue-500/10')
  })

  it('renders blue pill badge for stopping', () => {
    render(<SessionActivityDot state="stopping" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('aria-label', 'Session stopping')
    expect(badge).toHaveTextContent('Stopping')
    expect(badge.className).toContain('bg-blue-500/10')
  })

  it('renders red static badge for error', () => {
    render(<SessionActivityDot state="error" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('aria-label', 'Session error')
    expect(badge).toHaveTextContent('Error')
    expect(badge.className).toContain('bg-red-500/10')
    // Inner dot should NOT animate
    const innerDot = badge.querySelector('[aria-hidden="true"]')
    expect(innerDot).toBeTruthy()
    expect(innerDot!.className).not.toContain('animate-pulse')
  })

  it('renders nothing for stopped', () => {
    const { container } = render(<SessionActivityDot state="stopped" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders pill shape with inner dot and label', () => {
    render(<SessionActivityDot state="streaming" />)
    const badge = screen.getByRole('status')
    // Pill shape
    expect(badge.className).toContain('rounded-full')
    // Inner dot element
    const innerDot = badge.querySelector('[aria-hidden="true"]')
    expect(innerDot).toBeTruthy()
    expect(innerDot!.className).toContain('w-1.5')
    expect(innerDot!.className).toContain('h-1.5')
    expect(innerDot!.className).toContain('rounded-full')
    expect(innerDot!.className).toContain('bg-green-500')
  })

  it('respects prefers-reduced-motion on inner dot', () => {
    render(<SessionActivityDot state="streaming" />)
    const badge = screen.getByRole('status')
    const innerDot = badge.querySelector('[aria-hidden="true"]')
    expect(innerDot).toBeTruthy()
    // motion-safe: prefix ensures animation only when no motion preference
    expect(innerDot!.className).toContain('motion-safe:animate-pulse')
  })
})
