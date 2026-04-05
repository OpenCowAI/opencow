// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import { useIssueProviderStore } from '../../../src/renderer/stores/issueProviderStore'
import type { Project } from '../../../src/shared/types'
import { ProjectSettingsModal } from '../../../src/renderer/components/ProjectSettings/ProjectSettingsModal'

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

describe('ProjectSettingsModal', () => {
  beforeEach(() => {
    useAppStore.setState({
      projects: [makeProject()],
      updateProjectById: vi.fn(),
    })

    useIssueProviderStore.setState({
      providers: [],
      loading: false,
      loadProviders: vi.fn(async () => {}),
      createProvider: vi.fn(),
      updateProvider: vi.fn(),
      deleteProvider: vi.fn(),
      testConnection: vi.fn(),
      triggerSync: vi.fn(),
      reset: vi.fn(),
    })
  })

  it('renders visible modal title and per-tab page headers', async () => {
    render(<ProjectSettingsModal projectId="proj-1" onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Project Settings', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General', level: 3 })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Browser' }))
    expect(screen.getByRole('heading', { name: 'Browser', level: 3 })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Issue Integration' }))

    expect(screen.getByRole('heading', { name: 'Issue Integration', level: 3 })).toBeInTheDocument()
  })
})
