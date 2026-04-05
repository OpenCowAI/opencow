// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ContextMentionPopover } from '../../../src/renderer/components/DetailPanel/SessionPanel/ContextMentionPopover'
import { ProjectScopeProvider } from '../../../src/renderer/contexts/ProjectScopeContext'
import { ContextFilesProvider } from '../../../src/renderer/contexts/ContextFilesContext'

const listProjectFilesMock = vi.fn()

function renderPopover(): void {
  render(
    <ProjectScopeProvider projectPath="/tmp/project" projectId="proj-1">
      <ContextFilesProvider>
        <ContextMentionPopover onClose={vi.fn()} />
      </ContextFilesProvider>
    </ProjectScopeProvider>,
  )
}

function clickChevron(label: string): void {
  const row = screen.getByRole('treeitem', { name: new RegExp(`\\b${label}\\b`) })
  const chevron = row.firstElementChild as HTMLElement | null
  expect(chevron).not.toBeNull()
  fireEvent.click(chevron!)
}

describe('ContextMentionPopover', () => {
  beforeEach(() => {
    listProjectFilesMock.mockReset()
    ;(window as unknown as Record<string, unknown>).opencow = {
      ...((window as unknown as Record<string, unknown>).opencow as Record<string, unknown>),
      'list-project-files': listProjectFilesMock,
      'search-project-files': vi.fn().mockResolvedValue([]),
    }
  })

  it('collapsing parent directory clears expanded descendants', async () => {
    listProjectFilesMock.mockImplementation(async (_projectPath: string, subPath?: string) => {
      if (!subPath) {
        return [{ name: 'src', path: 'src', isDirectory: true, size: 0, modifiedAt: 1 }]
      }
      if (subPath === 'src') {
        return [{ name: 'components', path: 'src/components', isDirectory: true, size: 0, modifiedAt: 1 }]
      }
      if (subPath === 'src/components') {
        return [{ name: 'ui', path: 'src/components/ui', isDirectory: true, size: 0, modifiedAt: 1 }]
      }
      return []
    })

    renderPopover()

    await screen.findByRole('treeitem', { name: /\bsrc\b/ })
    clickChevron('src')

    await screen.findByRole('treeitem', { name: /\bcomponents\b/ })
    clickChevron('components')

    await screen.findByRole('treeitem', { name: /\bui\b/ })
    expect(screen.getByRole('treeitem', { name: /\bui\b/ })).toBeInTheDocument()

    // Collapse parent: src
    clickChevron('src')
    await waitFor(() => {
      expect(screen.queryByRole('treeitem', { name: /\bcomponents\b/ })).not.toBeInTheDocument()
    })

    // Re-expand parent: src
    clickChevron('src')
    await screen.findByRole('treeitem', { name: /\bcomponents\b/ })

    // Descendant should remain collapsed after parent reopen
    expect(screen.queryByRole('treeitem', { name: /\bui\b/ })).not.toBeInTheDocument()
  })
})
