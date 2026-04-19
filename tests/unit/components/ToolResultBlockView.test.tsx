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
  it('suppresses non-error short content entirely', () => {
    const { container } = render(<ToolResultBlockView block={makeBlock()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders empty content as nothing', () => {
    const { container } = render(<ToolResultBlockView block={makeBlock({ content: '' })} />)
    expect(container.innerHTML).toBe('')
  })

  it('suppresses non-error long content entirely', () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    const { container } = render(<ToolResultBlockView block={makeBlock({ content: longContent })} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText(/show more.*30 lines/i)).not.toBeInTheDocument()
    expect(screen.queryByText('line 25')).not.toBeInTheDocument()
  })

  it('shows long error content collapsed by default', () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent, isError: true })} />)
    expect(screen.getByText(/line 20/)).toBeInTheDocument()
    expect(screen.queryByText('line 25')).not.toBeInTheDocument()
    expect(screen.getByText(/show more/i)).toBeInTheDocument()
  })

  it('expands long error content on show more click', async () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent, isError: true })} />)

    await userEvent.click(screen.getByText(/show more/i))
    expect(screen.getByText(/line 25/)).toBeInTheDocument()
    expect(screen.getByText(/show less/i)).toBeInTheDocument()
  })

  it('collapses expanded content on show less click', async () => {
    const longContent = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
    render(<ToolResultBlockView block={makeBlock({ content: longContent, isError: true })} />)

    await userEvent.click(screen.getByText(/show more/i))
    await userEvent.click(screen.getByText(/show less/i))
    expect(screen.queryByText('line 25')).not.toBeInTheDocument()
  })

  it('shows error content immediately with red border', () => {
    const { container } = render(
      <ToolResultBlockView block={makeBlock({ content: 'Error: not found', isError: true })} />
    )
    expect(screen.getByText('Error: not found')).toBeInTheDocument()
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain('border-red-500')
  })

  it('does not render reveal or hide controls for error results', () => {
    render(<ToolResultBlockView block={makeBlock({ content: 'Error: not found', isError: true })} />)
    expect(screen.queryByText(/show result/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/hide result/i)).not.toBeInTheDocument()
  })
})
