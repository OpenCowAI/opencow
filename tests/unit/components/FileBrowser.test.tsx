// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { FileBrowser } from '../../../src/renderer/components/FilesView/FileBrowser'
import { useFileStore } from '../../../src/renderer/stores/fileStore'
import type { FileEntry } from '../../../src/shared/types'

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Panel: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Separator: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

vi.mock('../../../src/renderer/components/ui/code-viewer', () => ({
  CodeViewer: ({ content }: { content: string }) => <pre>{content}</pre>,
}))

function makeFileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    name: 'README.txt',
    path: 'README.txt',
    isDirectory: false,
    size: 128,
    modifiedAt: Date.now(),
    ...overrides,
  }
}

describe('FileBrowser dialog animation lifecycle', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn()
    }
    ;(window as unknown as Record<string, unknown>).opencow = {
      'list-project-files': vi.fn().mockResolvedValue([makeFileEntry()]),
      'read-file-content': vi.fn().mockResolvedValue({
        ok: true,
        data: {
          content: 'Hello',
          language: 'plaintext',
          size: 7,
        },
      }),
      'read-image-preview': vi.fn().mockResolvedValue({
        ok: true,
        data: {
          dataUrl: 'data:image/png;base64,thumb',
          mimeType: 'image/png',
          size: 10,
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
    vi.useRealTimers()
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

    await user.click(await screen.findByRole('gridcell', { name: /open file readme\.txt/i }))
    expect(await screen.findByRole('dialog', { name: 'README.txt' })).toBeInTheDocument()
    expect(screen.getByText('plaintext')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close preview/i }))
    expect(screen.queryByRole('dialog', { name: 'README.txt' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'README.txt' })).not.toBeInTheDocument()
    }, { timeout: 1000 })
  })

  it('emits internal file drag payload on dragstart', async () => {
    render(
      <FileBrowser
        projectPath="/tmp/project"
        projectName="project"
        projectId="project-1"
      />,
    )

    // Ensure grid rendered and focus target exists.
    const fileCell = await screen.findByRole('gridcell', { name: /open file readme\.txt/i })

    const setData = vi.fn()
    const setDragImage = vi.fn()
    const dataTransfer = {
      setData,
      setDragImage,
      effectAllowed: '',
      types: [],
    } as unknown as DataTransfer

    fireEvent.dragStart(fileCell, { dataTransfer })

    expect(setData).toHaveBeenCalledTimes(1)
    const [mime, raw] = setData.mock.calls[0] as [string, string]
    expect(mime).toBe('application/x-opencow-file')
    expect(JSON.parse(raw)).toEqual({
      path: 'README.txt',
      name: 'README.txt',
      isDirectory: false,
    })
    expect((dataTransfer as unknown as { effectAllowed: string }).effectAllowed).toBe('copy')
    expect(setDragImage).toHaveBeenCalledTimes(1)
  })

  it('limits thumbnail prefetch count and request concurrency in large directories', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const readImagePreview = vi.fn(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return {
        ok: true as const,
        data: {
          dataUrl: 'data:image/png;base64,thumb',
          mimeType: 'image/png',
          size: 10,
        },
      }
    })

    const imageEntries = Array.from({ length: 80 }, (_, i) =>
      makeFileEntry({
        name: `image-${i}.png`,
        path: `image-${i}.png`,
      }),
    )
    const api = (window as unknown as { opencow: Record<string, unknown> }).opencow
    ;(api['list-project-files'] as Mock).mockResolvedValue(imageEntries)
    api['read-image-preview'] = readImagePreview as unknown

    render(
      <FileBrowser
        projectPath="/tmp/project"
        projectName="project"
        projectId="project-1"
      />,
    )

    await screen.findByRole('grid')
    await waitFor(() => {
      expect(readImagePreview).toHaveBeenCalledTimes(60)
    })

    expect(readImagePreview).toHaveBeenCalledTimes(60)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  it('restores last browser sub-path per project across remounts', async () => {
    const rootEntries = [
      makeFileEntry({
        name: 'src',
        path: 'src',
        isDirectory: true,
      }),
    ]
    const nestedEntries = [
      makeFileEntry({
        name: 'inner.ts',
        path: 'src/inner.ts',
      }),
    ]

    const api = (window as unknown as { opencow: Record<string, unknown> }).opencow
    ;(api['list-project-files'] as Mock).mockImplementation((_projectPath: string, subPath?: string) => {
      if (subPath === 'src') return Promise.resolve(nestedEntries)
      return Promise.resolve(rootEntries)
    })

    const user = userEvent.setup()
    const { unmount } = render(
      <FileBrowser
        projectPath="/tmp/project"
        projectName="project"
        projectId="project-1"
      />,
    )

    await user.click(await screen.findByRole('gridcell', { name: /open folder src/i }))
    expect(await screen.findByRole('gridcell', { name: /open file inner\.ts/i })).toBeInTheDocument()
    expect(useFileStore.getState().browserSubPathByProject['project-1']).toBe('src')

    unmount()

    render(
      <FileBrowser
        projectPath="/tmp/project"
        projectName="project"
        projectId="project-1"
      />,
    )

    expect(await screen.findByRole('gridcell', { name: /open file inner\.ts/i })).toBeInTheDocument()
  })
})
