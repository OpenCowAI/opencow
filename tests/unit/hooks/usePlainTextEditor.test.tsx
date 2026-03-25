// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { EditorContent } from '@tiptap/react'
import { usePlainTextEditor, type UsePlainTextEditorOptions } from '../../../src/renderer/hooks/usePlainTextEditor'

/* ------------------------------------------------------------------ */
/*  Test harness: renders the TipTap editor with configurable options  */
/* ------------------------------------------------------------------ */

function TestEditor(props: UsePlainTextEditorOptions): React.JSX.Element {
  const editor = usePlainTextEditor(props)
  return <EditorContent editor={editor} />
}

async function getEditor(): Promise<HTMLElement> {
  return screen.findByRole('textbox')
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('usePlainTextEditor', () => {
  it('creates an editor instance with role="textbox"', async () => {
    render(<TestEditor />)
    const editor = await getEditor()
    expect(editor).toBeInTheDocument()
    expect(editor).toHaveAttribute('role', 'textbox')
    expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  it('applies aria-label from options', async () => {
    render(<TestEditor ariaLabel="My input" />)
    const editor = await getEditor()
    expect(editor).toHaveAttribute('aria-label', 'My input')
  })

  it('applies aria-multiline and spellcheck attributes', async () => {
    render(<TestEditor />)
    const editor = await getEditor()
    expect(editor).toHaveAttribute('aria-multiline', 'true')
    expect(editor).toHaveAttribute('spellcheck', 'false')
    expect(editor).toHaveAttribute('autocomplete', 'off')
  })

  it('shows placeholder via data-placeholder attribute', async () => {
    render(<TestEditor placeholder="Enter text…" />)
    const editor = await getEditor()
    const paragraph = editor.querySelector('p')
    expect(paragraph).toBeTruthy()
    expect(paragraph?.getAttribute('data-placeholder')).toBe('Enter text…')
  })

  it('sets contenteditable="false" when editable is false', async () => {
    render(<TestEditor editable={false} />)
    const editor = await getEditor()
    expect(editor).toHaveAttribute('contenteditable', 'false')
  })

  it('toggles editable state reactively', async () => {
    const { rerender } = render(<TestEditor editable={true} />)
    const editor = await getEditor()
    expect(editor).toHaveAttribute('contenteditable', 'true')

    rerender(<TestEditor editable={false} />)
    await waitFor(() => {
      expect(editor).toHaveAttribute('contenteditable', 'false')
    })

    rerender(<TestEditor editable={true} />)
    await waitFor(() => {
      expect(editor).toHaveAttribute('contenteditable', 'true')
    })
  })

  it('calls onEnter when Enter is pressed', async () => {
    const onEnter = vi.fn()
    render(<TestEditor onEnter={onEnter} />)
    const editor = await getEditor()
    await userEvent.click(editor)
    await userEvent.type(editor, 'test')
    await userEvent.keyboard('{Enter}')
    expect(onEnter).toHaveBeenCalledOnce()
  })

  it('does not call onEnter on Shift+Enter', async () => {
    const onEnter = vi.fn()
    render(<TestEditor onEnter={onEnter} />)
    const editor = await getEditor()
    await userEvent.click(editor)
    await userEvent.type(editor, 'line')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('has plain-text-editor CSS class on ProseMirror root', async () => {
    render(<TestEditor />)
    const editor = await getEditor()
    expect(editor.classList.contains('plain-text-editor')).toBe(true)
  })
})
