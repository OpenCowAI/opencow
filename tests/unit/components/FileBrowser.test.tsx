// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { FileBrowser } from '../../../src/renderer/components/FilesView/FileBrowser'
import type { FileEntry } from '../../../src/shared/types'

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: 'README.md',
    path: 'README.md',
    isDirectory: false,
    size: 128,
    modifiedAt: Date.now(),
    ...overrides,
  }
}

describe('FileBrowser dialog animation lifecycle', () => {
  beforeEach(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn()
    }
    ;(window as unknown as Record<string, unknown>).opencow = {
      'list-project-files': vi.fn().mockResolvedValue([makeFileEntry()]),
      'read-file-content': vi.fn().mockResolvedValue({
        ok: true,
        data: {
          content: '# Hello',
          language: 'markdown',
          size: 7,
        },
      }),
      'list-artifacts': vi.fn().mockResolvedValue([]),
      'update-artifact-meta': vi.fn().mockResolvedValue(undefined),
      'star-session-artifact': vi.fn().mockResolvedValue({ id: 'art-1', starred: true }),
      'star-project-file': vi.fn().mockResolvedValue({ id: 'art-1', starred: true }),
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps dialog mounted for exit animation before unmounting', async () => {
    const user = userEvent.setup()
    render(
      <FileBrowser
        projectPath="/tmp/project"
        projectName="project"
        projectId="project-1"
      />,
    )

    await user.click(await screen.findByRole('gridcell', { name: /open file readme\.md/i }))
    expect(await screen.findByRole('dialog', { name: 'README.md' })).toBeInTheDocument()
    expect(screen.getByText('# Hello')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close preview/i }))
    expect(screen.queryByRole('dialog', { name: 'README.md' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'README.md' })).not.toBeInTheDocument()
    }, { timeout: 1000 })
  })
})
