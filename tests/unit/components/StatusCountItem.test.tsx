// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StatusCountItem } from '../../../src/renderer/components/ui/StatusCountItem'

describe('StatusCountItem', () => {
  it('renders dot + count + label', () => {
    render(<StatusCountItem status="active" count={5} />)
    expect(screen.getByText(/5/)).toBeInTheDocument()
    expect(screen.getByText(/active/i)).toBeInTheDocument()
  })

  it('hides when count is 0 and hideWhenZero is true', () => {
    const { container } = render(<StatusCountItem status="error" count={0} hideWhenZero />)
    expect(container.innerHTML).toBe('')
  })

  it('shows when count is 0 and hideWhenZero is false', () => {
    render(<StatusCountItem status="error" count={0} />)
    expect(screen.getByText(/0/)).toBeInTheDocument()
  })

  it('contains a StatusDot (span with rounded-full)', () => {
    const { container } = render(<StatusCountItem status="waiting" count={3} />)
    const dot = container.querySelector('span.rounded-full')
    expect(dot).not.toBeNull()
  })
})
