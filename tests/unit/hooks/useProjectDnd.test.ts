// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { GroupedProjects, Project } from '../../../src/shared/types'
import {
  useProjectDnd,
  DROPPABLE_PINNED,
  DROPPABLE_PROJECTS,
} from '../../../src/renderer/hooks/useProjectDnd'

const reorderProjectsMock = vi.fn()
const reorderPinnedProjectsMock = vi.fn()
const pinProjectMock = vi.fn(async () => undefined)
const unpinProjectMock = vi.fn(async () => undefined)

vi.mock('../../../src/renderer/stores/appStore', () => ({
  useAppStore: (selector: (state: any) => unknown) => selector({
    reorderProjects: reorderProjectsMock,
    reorderPinnedProjects: reorderPinnedProjectsMock,
    pinProject: pinProjectMock,
    unpinProject: unpinProjectMock,
  }),
}))

function makeProject(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    path: `/tmp/${id}`,
    name: id,
    sessionCount: 0,
    pinOrder: null,
    archivedAt: null,
    displayOrder: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('useProjectDnd', () => {
  beforeEach(() => {
    reorderProjectsMock.mockReset()
    reorderPinnedProjectsMock.mockReset()
    pinProjectMock.mockReset()
    unpinProjectMock.mockReset()
    pinProjectMock.mockResolvedValue(undefined)
    unpinProjectMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reorders regular projects when dropped on projects container', () => {
    const grouped: GroupedProjects = {
      pinned: [],
      projects: [makeProject('p1'), makeProject('p2'), makeProject('p3')],
      archived: [],
    }

    const { result } = renderHook(() => useProjectDnd(grouped))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'p1' },
        over: { id: DROPPABLE_PROJECTS },
      } as any)
    })

    expect(reorderProjectsMock).toHaveBeenCalledTimes(1)
    expect(reorderProjectsMock).toHaveBeenCalledWith(['p2', 'p3', 'p1'])
    expect(reorderPinnedProjectsMock).not.toHaveBeenCalled()
  })

  it('reorders pinned projects when dropped on pinned container', () => {
    const grouped: GroupedProjects = {
      pinned: [
        makeProject('pin-a', { pinOrder: 0 }),
        makeProject('pin-b', { pinOrder: 1 }),
        makeProject('pin-c', { pinOrder: 2 }),
      ],
      projects: [],
      archived: [],
    }

    const { result } = renderHook(() => useProjectDnd(grouped))

    act(() => {
      result.current.onDragEnd({
        active: { id: 'pin-a' },
        over: { id: DROPPABLE_PINNED },
      } as any)
    })

    expect(reorderPinnedProjectsMock).toHaveBeenCalledTimes(1)
    expect(reorderPinnedProjectsMock).toHaveBeenCalledWith(['pin-b', 'pin-c', 'pin-a'])
    expect(reorderProjectsMock).not.toHaveBeenCalled()
  })
})
