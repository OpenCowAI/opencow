// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ThinkingBlockView } from '../../../src/renderer/components/DetailPanel/SessionPanel/ThinkingBlockView'
import type { ThinkingBlock } from '../../../src/shared/types'

function makeBlock(overrides: Partial<ThinkingBlock> = {}): ThinkingBlock {
  return {
    type: 'thinking',
    thinking: 'Let me analyze this problem step by step.',
    ...overrides
  }
}

describe('ThinkingBlockView', () => {
  it('renders collapsed by default with "Thinking..." label', () => {
    render(<ThinkingBlockView block={makeBlock()} />)
    expect(screen.getByText(/thinking/i)).toBeInTheDocument()
    expect(screen.queryByText('Let me analyze this problem step by step.')).not.toBeInTheDocument()
  })

  it('expands to show thinking text on click', async () => {
    render(<ThinkingBlockView block={makeBlock()} />)

    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Let me analyze this problem step by step.')).toBeInTheDocument()
  })

  it('collapses on second click', async () => {
    render(<ThinkingBlockView block={makeBlock()} />)

    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Let me analyze this problem step by step.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Let me analyze this problem step by step.')).not.toBeInTheDocument()
  })

  it('has aria-expanded attribute', () => {
    render(<ThinkingBlockView block={makeBlock()} />)
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('sets aria-expanded to true when expanded', async () => {
    render(<ThinkingBlockView block={makeBlock()} />)
    const button = screen.getByRole('button')

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})
