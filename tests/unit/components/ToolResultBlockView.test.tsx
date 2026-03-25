// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ToolResultBlockView } from '../../../src/renderer/components/DetailPanel/SessionPanel/ToolResultBlockView'
import type { ToolResultBlock } from '../../../src/shared/types'

function makeBlock(overrides: Partial<ToolResultBlock> = {}): ToolResultBlock {
  return {
    type: 'tool_result',
    toolUseId: 'tu-1',
    content: 'single line result',
    ...overrides
  }
}

describe('ToolResultBlockView', () => {
  it('renders short content fully', () => {
    render(<ToolResultBlockView block={makeBlock()} />)
    expect(screen.getByText('single line result')).toBeInTheDocument()
    expect(screen.queryByText(/show more/i)).not.toBeInTheDocument()
  })

  it('renders empty content as nothing', () => {
    const { container } = render(<ToolResultBlockView block={makeBlock({ content: '' })} />)
    expect(container.innerHTML).toBe('')
  })

  it('collapses content > 20 lines by default', () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent })} />)
    // Should show "Show more" button
    expect(screen.getByText(/show more.*30 lines/i)).toBeInTheDocument()
    // Should NOT show all lines
    expect(screen.queryByText('line 25')).not.toBeInTheDocument()
  })

  it('expands collapsed content on click', async () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent })} />)

    await userEvent.click(screen.getByText(/show more/i))
    expect(screen.getByText(/line 25/)).toBeInTheDocument()
    expect(screen.getByText(/show less/i)).toBeInTheDocument()
  })

  it('collapses expanded content on show less click', async () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent })} />)

    await userEvent.click(screen.getByText(/show more/i))
    await userEvent.click(screen.getByText(/show less/i))
    expect(screen.queryByText('line 25')).not.toBeInTheDocument()
  })

  it('shows red border for error results', () => {
    const { container } = render(
      <ToolResultBlockView block={makeBlock({ content: 'Error: not found', isError: true })} />
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain('border-red-500')
  })

  it('does not show red border for non-error results', () => {
    const { container } = render(
      <ToolResultBlockView block={makeBlock({ isError: false })} />
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).not.toContain('border-red-500')
  })
})
