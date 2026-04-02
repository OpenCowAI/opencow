// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/renderer/stores/appStore'
import type { Project } from '../../../src/shared/types'

const reorderProjectsIPC = vi.fn(async () => undefined)
const reorderPinnedProjectsIPC = vi.fn(async () => undefined)

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => ({
    'reorder-projects': reorderProjectsIPC,
    'reorder-pinned-projects': reorderPinnedProjectsIPC,
  }),
}))

function makeProject(id: string, displayOrder: number): Project {
  return {
    id,
    path: `/tmp/${id}`,
    name: id,
    sessionCount: 0,
    pinOrder: null,
    archivedAt: null,
    displayOrder,
    updatedAt: Date.now(),
    preferences: {
      defaultTab: 'issues',
      defaultChatViewMode: 'default',
      defaultFilesDisplayMode: null,
    },
  }
}

describe('appStore reorder persistence integration', () => {
  beforeEach(() => {
    reorderProjectsIPC.mockReset()
    reorderPinnedProjectsIPC.mockReset()
    reorderProjectsIPC.mockResolvedValue(undefined)
    reorderPinnedProjectsIPC.mockResolvedValue(undefined)

    useAppStore.setState({
      projects: [
        makeProject('A', 0),
        makeProject('B', 1),
        makeProject('C', 2),
      ],
    })
  })

  it('reorderProjects calls reorder-projects IPC with ordered IDs', async () => {
    useAppStore.getState().reorderProjects(['A', 'C', 'B'])

    // fireAndForget path schedules async call; wait a microtask turn
    await Promise.resolve()

    expect(reorderProjectsIPC).toHaveBeenCalledTimes(1)
    expect(reorderProjectsIPC).toHaveBeenCalledWith(['A', 'C', 'B'])
  })

  it('reorderPinnedProjects calls reorder-pinned-projects IPC with ordered IDs', async () => {
    useAppStore.getState().reorderPinnedProjects(['C', 'A', 'B'])

    await Promise.resolve()

    expect(reorderPinnedProjectsIPC).toHaveBeenCalledTimes(1)
    expect(reorderPinnedProjectsIPC).toHaveBeenCalledWith(['C', 'A', 'B'])
  })
})
