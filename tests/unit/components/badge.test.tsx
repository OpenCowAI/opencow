// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Badge } from '../../../src/renderer/components/ui/badge'

describe('Badge', () => {
  it('renders with completed variant', () => {
    render(<Badge variant="completed">Done</Badge>)
    const badge = screen.getByText('Done')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-gray-100')
  })

  it('renders all session-status variants without error', () => {
    const variants = ['active', 'waiting', 'error', 'completed'] as const
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>)
      expect(screen.getByText(variant)).toBeInTheDocument()
      unmount()
    }
  })
})
