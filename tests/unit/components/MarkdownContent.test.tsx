// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MarkdownContent } from '../../../src/renderer/components/ui/MarkdownContent'

describe('MarkdownContent', () => {
  it('renders plain text as paragraph', () => {
    render(<MarkdownContent content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold text', () => {
    render(<MarkdownContent content="**bold text**" />)
    expect(screen.getByText('bold text').tagName).toBe('STRONG')
  })

  it('renders inline code', () => {
    render(<MarkdownContent content="Use `const x = 1`" />)
    const code = screen.getByText('const x = 1')
    expect(code.tagName).toBe('CODE')
    expect(code.className).toContain('font-mono')
  })

  it('renders fenced code block with syntax highlighting', () => {
    const md = '```js\nconsole.log("hi")\n```'
    const { container } = render(<MarkdownContent content={md} />)
    const codeEl = container.querySelector('code')
    expect(codeEl).not.toBeNull()
    // rehype-highlight adds 'hljs' class for syntax highlighting
    expect(codeEl!.className).toContain('hljs')
    expect(codeEl!.className).toContain('language-js')
    // Full text content is preserved
    expect(codeEl!.textContent).toContain('console')
    expect(codeEl!.textContent).toContain('log')
  })

  it('renders code block without language as plain text', () => {
    const md = '```\nplain text block\n```'
    const { container } = render(<MarkdownContent content={md} />)
    const codeEl = container.querySelector('code')
    expect(codeEl).not.toBeNull()
    expect(codeEl!.textContent).toContain('plain text block')
  })

  it('renders links with target _blank', () => {
    render(<MarkdownContent content="[click](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'click' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders unordered list', () => {
    const md = ['- item 1', '- item 2'].join('\n')
    render(<MarkdownContent content={md} />)
    expect(screen.getByText('item 1')).toBeInTheDocument()
    expect(screen.getByText('item 2')).toBeInTheDocument()
  })

  it('preserves ordered list start index across split lists', () => {
    const md = [
      '1. first',
      '',
      'continuation paragraph',
      '',
      '2. second',
      '3. third',
    ].join('\n')

    const { container } = render(<MarkdownContent content={md} />)
    const olList = container.querySelectorAll('ol')
    expect(olList.length).toBeGreaterThan(1)
    expect(olList[1]).toHaveAttribute('start', '2')
  })
})
