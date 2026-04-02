// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useFileStore } from '../../../src/renderer/stores/fileStore'
import { EditorPane } from '../../../src/renderer/components/FilesView/EditorPane'

const mockMonacoEditor = vi.fn((props: Record<string, unknown>) => {
  const onChange = props.onChange as ((value: string | undefined) => void) | undefined
  return (
    <div data-testid="monaco-editor" data-language={String(props.language ?? '')}>
      <button
        type="button"
        data-testid="monaco-type"
        onClick={() => onChange?.('__edited_source__')}
      >
        type
      </button>
    </div>
  )
})

vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => mockMonacoEditor(props),
  loader: { config: vi.fn() },
}))

vi.mock('monaco-editor', () => ({}))
vi.mock('../../../src/renderer/hooks/useMonacoTheme', () => ({
  useMonacoTheme: () => 'vs-dark',
}))
vi.mock('../../../src/renderer/hooks/useGutterDiff', () => ({
  useGutterDiff: vi.fn(),
}))
vi.mock('../../../src/renderer/components/ui/MarkdownPreviewWithToc', () => ({
  MarkdownPreviewWithToc: () => <div data-testid="md-preview">md preview</div>,
}))
vi.mock('../../../src/renderer/components/DetailPanel/ImageLightbox', () => ({
  ImageLightbox: () => null,
}))
vi.mock('../../../src/renderer/lib/htmlSandbox', () => ({
  wrapHtmlForSafePreview: (html: string) => html,
}))

describe('EditorPane', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
    mockMonacoEditor.mockClear()
  })

  it('renders editable source editor for markdown files and updates store on change', async () => {
    useFileStore.getState().openFile({
      path: 'README.md',
      name: 'README.md',
      language: 'markdown',
      content: '# hello',
      viewKind: 'text',
    })

    render(<EditorPane projectPath="/tmp/project" />)

    expect(await screen.findByTestId('md-preview')).toBeInTheDocument()

    const sourceTab = screen.getByRole('tab', { name: /source/i })
    await userEvent.click(sourceTab)

    expect(await screen.findByTestId('monaco-editor')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('monaco-type'))

    const file = useFileStore.getState().openFiles.find((f) => f.path === 'README.md')
    expect(file?.content).toBe('__edited_source__')
    expect(file?.isDirty).toBe(true)
  })
})

