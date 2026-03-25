// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { AttachmentPreviewList } from '../../../src/renderer/components/ui/AttachmentPreviewList'
import type { ProcessedAttachment } from '../../../src/renderer/lib/attachmentUtils'

const IMAGE_ATTACHMENT: ProcessedAttachment = {
  kind: 'image',
  id: 'img-1',
  fileName: 'screenshot.png',
  mediaType: 'image/png',
  base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  sizeBytes: 128,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
}

const CUSTOM_LABELS = {
  previewImage: 'Preview attached image',
  removeFile: 'Delete attached file',
  attachedImageFallbackAlt: 'Attached screenshot',
  fallbackFileName: 'document',
}

describe('AttachmentPreviewList', () => {
  it('renders image preview button when lightbox mode is enabled', () => {
    render(
      <AttachmentPreviewList
        attachments={[IMAGE_ATTACHMENT]}
        onRemove={vi.fn()}
        image={{ previewMode: 'lightbox' }}
      />
    )

    expect(screen.getByRole('button', { name: 'Preview image' })).toBeInTheDocument()
  })

  it('does not render image preview button by default', () => {
    render(<AttachmentPreviewList attachments={[IMAGE_ATTACHMENT]} onRemove={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Preview image' })).not.toBeInTheDocument()
  })

  it('uses caller-provided labels for accessible copy', () => {
    render(
      <AttachmentPreviewList
        attachments={[IMAGE_ATTACHMENT]}
        onRemove={vi.fn()}
        image={{ previewMode: 'lightbox' }}
        labels={CUSTOM_LABELS}
      />
    )

    expect(screen.getByRole('button', { name: CUSTOM_LABELS.previewImage })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: CUSTOM_LABELS.removeFile })).toBeInTheDocument()
  })

  it('opens lightbox on thumbnail click and closes on Escape', async () => {
    const user = userEvent.setup()

    render(
      <AttachmentPreviewList
        attachments={[IMAGE_ATTACHMENT]}
        onRemove={vi.fn()}
        image={{ previewMode: 'lightbox' }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Preview image' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const externalCaptureListener = vi.fn()
    document.addEventListener('keydown', externalCaptureListener, true)

    await user.keyboard('{Escape}')

    expect(externalCaptureListener).not.toHaveBeenCalled()
    document.removeEventListener('keydown', externalCaptureListener, true)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
