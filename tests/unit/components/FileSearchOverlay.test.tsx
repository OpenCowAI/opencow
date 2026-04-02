// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { FileSearchOverlay } from '../../../src/renderer/components/FilesView/FileSearchOverlay'
import { useFileStore } from '../../../src/renderer/stores/fileStore'
import { useFilesQuickSearch } from '../../../src/renderer/hooks/useFilesQuickSearch'
import type { FileSearchNavigationCommand } from '../../../src/renderer/lib/fileSearchNavigation'

vi.mock('../../../src/renderer/hooks/useFilesQuickSearch', () => ({
  useFilesQuickSearch: vi.fn(() => ({
    loading: false,
    items: [
      {
        path: 'src/App.tsx',
        name: 'App.tsx',
        isDirectory: false,
        score: 100,
        nameHighlights: [0, 1, 2],
        pathHighlights: [4, 5, 6],
        source: 'search',
      },
    ],
  })),
}))

const useFilesQuickSearchMock = vi.mocked(useFilesQuickSearch)

describe('FileSearchOverlay', () => {
  beforeEach(() => {
    useFilesQuickSearchMock.mockReset()
    useFilesQuickSearchMock.mockReturnValue({
      loading: false,
      items: [
        {
          path: 'src/App.tsx',
          name: 'App.tsx',
          isDirectory: false,
          score: 100,
          nameHighlights: [0, 1, 2],
          pathHighlights: [4, 5, 6],
          source: 'search',
        },
      ],
    })
    useFileStore.getState().reset()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens and triggers default enter action', async () => {
    const onClose = vi.fn()
    const onExecuteCommand = vi.fn<(command: FileSearchNavigationCommand) => void>()

    render(
      <FileSearchOverlay
        open
        projectId="project-1"
        projectPath="/tmp/project"
        currentMode="ide"
        openFiles={[]}
        onClose={onClose}
        onExecuteCommand={onExecuteCommand}
      />,
    )

    const input = screen.getByRole('textbox', { name: /search files/i })
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')

    expect(onExecuteCommand).toHaveBeenCalledTimes(1)
    expect(onExecuteCommand).toHaveBeenCalledWith({
      kind: 'open-current',
      target: {
        path: 'src/App.tsx',
        name: 'App.tsx',
        isDirectory: false,
      },
      context: { mode: 'ide' },
      options: { line: null },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('supports modifier actions for Enter', async () => {
    const onClose = vi.fn()
    const onExecuteCommand = vi.fn<(command: FileSearchNavigationCommand) => void>()

    render(
      <FileSearchOverlay
        open
        projectId="project-1"
        projectPath="/tmp/project"
        currentMode="ide"
        openFiles={[]}
        onClose={onClose}
        onExecuteCommand={onExecuteCommand}
      />,
    )

    const input = screen.getByRole('textbox', { name: /search files/i })
    await userEvent.click(input)
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onExecuteCommand).toHaveBeenCalledWith({
      kind: 'open-editor',
      target: {
        path: 'src/App.tsx',
        name: 'App.tsx',
        isDirectory: false,
      },
      options: { line: null },
    })

    onClose.mockClear()
    onExecuteCommand.mockClear()
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
    expect(onExecuteCommand).toHaveBeenCalledWith({
      kind: 'reveal',
      target: {
        path: 'src/App.tsx',
        name: 'App.tsx',
        isDirectory: false,
      },
      context: { mode: 'ide' },
    })
  })

  it('shows directory-specific action labels in browser mode', async () => {
    useFilesQuickSearchMock.mockReturnValue({
      loading: false,
      items: [
        {
          path: 'src/components',
          name: 'components',
          isDirectory: true,
          score: 90,
          nameHighlights: [0],
          pathHighlights: [0],
          source: 'search',
        },
      ],
    })

    render(
      <FileSearchOverlay
        open
        projectId="project-1"
        projectPath="/tmp/project"
        currentMode="browser"
        openFiles={[]}
        onClose={vi.fn()}
        onExecuteCommand={vi.fn()}
      />,
    )

    expect(await screen.findByText('Open folder')).toBeInTheDocument()
    expect(screen.getByText('⌘/Ctrl+Enter Reveal in tree')).toBeInTheDocument()
    expect(screen.getByText('Alt+Enter Reveal parent')).toBeInTheDocument()
  })

  it('keeps typed input stable while query is persisted to store', async () => {
    const onExecuteCommand = vi.fn<(command: FileSearchNavigationCommand) => void>()
    render(
      <FileSearchOverlay
        open
        projectId="project-1"
        projectPath="/tmp/project"
        currentMode="ide"
        openFiles={[]}
        onClose={vi.fn()}
        onExecuteCommand={onExecuteCommand}
      />,
    )

    const input = screen.getByRole('textbox', { name: /search files/i }) as HTMLInputElement
    await userEvent.click(input)
    await userEvent.type(input, 'abc')

    expect(input.value).toBe('abc')
    expect(useFileStore.getState().fileSearchQueryByProject['project-1']).toBe('abc')
  })
})
