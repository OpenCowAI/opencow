// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    const options = props.options as Record<string, unknown> | undefined
    return React.createElement('div', {
      'data-testid': 'monaco-editor',
      'data-language': props.language,
      'data-value': props.value,
      'data-readonly': String(!!options?.readOnly),
    })
  },
  loader: { config: vi.fn() }
}))
vi.mock('monaco-editor', () => ({}))

import { CodeEditor } from '../../../src/renderer/components/ui/code-editor'

describe('CodeEditor', () => {
  it('renders an editable Monaco editor', () => {
    render(<CodeEditor value="hello" language="markdown" onChange={vi.fn()} />)
    const editor = screen.getByTestId('monaco-editor')
    expect(editor).toHaveAttribute('data-value', 'hello')
    expect(editor).toHaveAttribute('data-language', 'markdown')
    expect(editor).toHaveAttribute('data-readonly', 'false')
  })

  it('wraps with aria-label', () => {
    const { container } = render(
      <CodeEditor value="test" language="json" onChange={vi.fn()} label="Edit source" />
    )
    expect(container.querySelector('[aria-label="Edit source"]')).toBeTruthy()
  })
})
