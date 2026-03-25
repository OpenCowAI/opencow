// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ComposeView } from '../../../src/renderer/components/DetailPanel/SessionPanel/ComposeView'
import type { ProcessedAttachment } from '../../../src/renderer/lib/attachmentUtils'

const defaultPrompt = {
  text: 'Issue: Test Issue\n\nFix the bug\n\nPlease work on this issue.',
  attachments: [] as ProcessedAttachment[],
}

/**
 * Helper: wait for the TipTap editor to be initialised.
 */
async function getEditor(): Promise<HTMLElement> {
  return screen.findByRole('textbox')
}

describe('ComposeView', () => {
  it('renders header and action buttons', () => {
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText('Compose Session Prompt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start session/i })).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /attach file/i })).toBeInTheDocument()
  })

  it('pre-fills editor with initial prompt text', async () => {
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const editor = await getEditor()
    // The editor should contain the initial text
    await waitFor(() => {
      expect(editor.textContent).toContain('Issue: Test Issue')
      expect(editor.textContent).toContain('Fix the bug')
    })
  })

  it('calls onCancel when Cancel button clicked', async () => {
    const onCancel = vi.fn()
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onCancel when back arrow clicked', async () => {
    const onCancel = vi.fn()
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /cancel compose/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('calls onSubmit with editor content when Start Session clicked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )

    // Wait for editor to be pre-filled and Start Session button to become enabled
    const editor = await getEditor()
    await waitFor(() => {
      expect(editor.textContent).toContain('Issue: Test Issue')
    })

    const startBtn = screen.getByRole('button', { name: /start session/i })
    // The button may still be disabled while TipTap's re-render propagates hasContent
    await waitFor(() => {
      expect(startBtn).not.toBeDisabled()
    })

    // Click Start Session
    await userEvent.click(startBtn)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce()
      // The content should be a string (text-only, no images)
      const content = onSubmit.mock.calls[0][0]
      expect(typeof content).toBe('string')
      expect(content).toContain('Issue: Test Issue')
    })
  })

  it('renders pre-populated images', async () => {
    const attachments: ProcessedAttachment[] = [
      {
        kind: 'image',
        id: 'img-1',
        fileName: 'preview.png',
        dataUrl: 'data:image/png;base64,abc123',
        mediaType: 'image/png',
        base64Data: 'abc123',
        sizeBytes: 1024,
      },
    ]

    render(
      <ComposeView
        initialPrompt={{ ...defaultPrompt, attachments }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Wait for images to be pre-populated
    await waitFor(() => {
      const imageList = screen.getByRole('list', { name: /attached files/i })
      expect(imageList).toBeInTheDocument()
      expect(screen.getByRole('listitem')).toBeInTheDocument()
    })
  })

  it('shows slash command hint in header', () => {
    render(
      <ComposeView
        initialPrompt={defaultPrompt}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText('/')).toBeInTheDocument()
  })
})
