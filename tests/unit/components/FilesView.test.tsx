// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { FilesView } from '../../../src/renderer/components/FilesView/FilesView'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useFileStore } from '../../../src/renderer/stores/fileStore'
import type { Project } from '../../../src/shared/types'
import { EMPTY_TAB_DETAILS } from '../../../src/renderer/stores/appStore'

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Panel: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Separator: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

vi.mock('../../../src/renderer/components/FilesView/EditorTabs', () => ({
  EditorTabs: () => <div data-testid="editor-tabs">editor-tabs</div>,
}))

vi.mock('../../../src/renderer/components/FilesView/EditorStatusBar', () => ({
  EditorStatusBar: () => <div data-testid="editor-status">editor-status</div>,
}))

vi.mock('../../../src/renderer/components/FilesView/FileTree', () => ({
  FileTree: () => <div data-testid="file-tree">file-tree</div>,
}))

vi.mock('../../../src/renderer/components/FilesView/EditorPane', () => ({
  EditorPane: () => <div data-testid="editor-pane">editor-pane</div>,
}))

vi.mock('../../../src/renderer/components/FilesView/FileBrowser', () => ({
  FileBrowser: () => <div data-testid="file-browser">file-browser</div>,
}))

vi.mock('../../../src/renderer/hooks/useFileSync', () => ({
  useFileSync: vi.fn(),
}))

vi.mock('../../../src/renderer/hooks/useGitStatus', () => ({
  useGitStatus: vi.fn(),
}))

const useFilesQuickSearchMock = vi.fn()
vi.mock('../../../src/renderer/hooks/useFilesQuickSearch', () => ({
  useFilesQuickSearch: (...args: unknown[]) => useFilesQuickSearchMock(...args),
}))

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    path: '/tmp/proj-1',
    name: 'Project 1',
    sessionCount: 0,
    pinOrder: null,
    archivedAt: null,
    displayOrder: 0,
    updatedAt: Date.now(),
    preferences: {
      defaultTab: 'issues',
      defaultChatViewMode: 'default',
      defaultFilesDisplayMode: 'ide',
      defaultBrowserStatePolicy: 'shared-global',
    },
    ...overrides,
  }
}

describe('FilesView search integration', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
    useAppStore.setState({
      projects: [makeProject()],
      appView: { mode: 'projects', tab: 'chat', projectId: 'proj-1' },
      filesDisplayModeByProject: { 'proj-1': 'browser' },
      detailContext: null,
      selectedSessionDetail: null,
      _tabDetails: { ...EMPTY_TAB_DETAILS },
      _projectStates: {},
    })

    ;(window as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }

    useFilesQuickSearchMock.mockReset()
    useFilesQuickSearchMock.mockReturnValue({
      loading: false,
      items: [
        {
          path: 'src/main.ts',
          name: 'main.ts',
          isDirectory: false,
          score: 100,
          nameHighlights: [0, 1, 2],
          pathHighlights: [4, 5, 6],
          source: 'search',
        },
      ],
    })

    ;(window as unknown as Record<string, unknown>).opencow = {
      'read-file-content': vi.fn().mockResolvedValue({
        ok: true,
        data: {
          content: 'console.log("ok")',
          language: 'typescript',
          size: 18,
        },
      }),
      'read-image-preview': vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'not_found', message: 'not image' },
      }),
      'list-project-files': vi.fn().mockResolvedValue([]),
      'git:get-status': vi.fn().mockResolvedValue(null),
      'search-project-files': vi.fn().mockResolvedValue([] as Array<{
        entry: { name: string; path: string; isDirectory: boolean; size: number; modifiedAt: number }
        score: number
        nameHighlights: number[]
        pathHighlights: number[]
      }>),
    }
  })

  it('Cmd/Ctrl+F + :line selection from browser mode opens editor and queues jump', async () => {
    render(<FilesView />)

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    const input = await screen.findByRole('textbox', { name: /search files/i })
    fireEvent.change(input, { target: { value: 'src/main.ts:23' } })
    await waitFor(() => {
      expect(useFileStore.getState().fileSearchQueryByProject['proj-1']).toBe('src/main.ts:23')
    })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(useAppStore.getState().filesDisplayModeByProject['proj-1']).toBe('ide')
      expect(useFileStore.getState().activeFilePathByProject['proj-1']).toBe('src/main.ts')
      const firstJumpIntent = useFileStore.getState().pendingEditorJumpIntentsByProject['proj-1']?.[0]
      expect(firstJumpIntent?.payload).toEqual({
        path: 'src/main.ts',
        line: 23,
      })
    })
  })
})
