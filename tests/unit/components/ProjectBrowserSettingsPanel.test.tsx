// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import type { Project } from '../../../src/shared/types'
import { ProjectBrowserSettingsPanel } from '../../../src/renderer/components/ProjectSettings/ProjectBrowserSettingsPanel'

const updateProjectMock = vi.fn()

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
      defaultFilesDisplayMode: null,
      defaultBrowserStatePolicy: 'shared-global',
    },
    ...overrides,
  }
}

describe('ProjectBrowserSettingsPanel', () => {
  beforeEach(() => {
    updateProjectMock.mockReset()
    updateProjectMock.mockResolvedValue(
      makeProject({
        preferences: {
          defaultTab: 'issues',
          defaultChatViewMode: 'default',
          defaultFilesDisplayMode: null,
          defaultBrowserStatePolicy: 'isolated-session',
        },
      }),
    )

    ;(window as unknown as Record<string, unknown>).opencow = {
      'update-project': updateProjectMock,
    }

    useAppStore.setState({
      projects: [makeProject()],
      updateProjectById: vi.fn((projectId: string, updater: (project: Project) => Project) => {
        useAppStore.setState((s) => ({
          projects: s.projects.map((p) => (p.id === projectId ? updater(p) : p)),
        }))
      }),
    })
  })

  it('saves browser default state policy selection', async () => {
    render(<ProjectBrowserSettingsPanel projectId="proj-1" />)

    await userEvent.click(screen.getByRole('radio', { name: 'Isolated: Session' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateProjectMock).toHaveBeenCalledWith('proj-1', {
        preferences: {
          defaultBrowserStatePolicy: 'isolated-session',
        },
      })
    })
  })
})
