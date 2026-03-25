// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { groupProjects } from '../../../src/shared/projectGrouping'
import type { Project } from '../../../src/shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    path: '/test/project',
    name: 'project',
    sessionCount: 1,
    pinOrder: null,
    archivedAt: null,
    displayOrder: 0,
    updatedAt: Date.now(),
    ...overrides
  }
}

describe('groupProjects', () => {
  it('puts unpinned non-archived projects into the projects group', () => {
    const projects = [makeProject({ id: 'p1' })]

    const result = groupProjects(projects)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].id).toBe('p1')
    expect(result.pinned).toHaveLength(0)
    expect(result.archived).toHaveLength(0)
  })

  it('respects pinned projects', () => {
    const projects = [
      makeProject({ id: 'p1', pinOrder: 0 }),
      makeProject({ id: 'p2', name: 'p2' })
    ]

    const result = groupProjects(projects)
    expect(result.pinned).toHaveLength(1)
    expect(result.pinned[0].id).toBe('p1')
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].id).toBe('p2')
  })

  it('preserves pin order', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'First', pinOrder: 1 }),
      makeProject({ id: 'p2', name: 'Second' }),
      makeProject({ id: 'p3', name: 'Third', pinOrder: 0 })
    ]

    const result = groupProjects(projects)
    expect(result.pinned.map((p) => p.id)).toEqual(['p3', 'p1'])
  })

  it('respects archived projects', () => {
    const projects = [makeProject({ id: 'p1', archivedAt: Date.now() })]

    const result = groupProjects(projects)
    expect(result.archived).toHaveLength(1)
    expect(result.projects).toHaveLength(0)
  })

  it('pin and archive are mutually exclusive (pinned wins)', () => {
    // In practice pin+archive is prevented by business logic,
    // but if both are set, pinOrder is checked first
    const projects = [makeProject({ id: 'p1', pinOrder: 0, archivedAt: Date.now() })]

    const result = groupProjects(projects)
    expect(result.pinned).toHaveLength(1)
    expect(result.archived).toHaveLength(0)
  })

  it('sorts projects by displayOrder', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Zebra', displayOrder: 2 }),
      makeProject({ id: 'p2', name: 'Alpha', displayOrder: 0 }),
      makeProject({ id: 'p3', name: 'Mid', displayOrder: 1 })
    ]

    const result = groupProjects(projects)
    expect(result.projects.map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('sorts archived projects alphabetically by name', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Zebra', archivedAt: Date.now() }),
      makeProject({ id: 'p2', name: 'Alpha', archivedAt: Date.now() }),
      makeProject({ id: 'p3', name: 'Mid', archivedAt: Date.now() })
    ]

    const result = groupProjects(projects)
    expect(result.archived.map((p) => p.name)).toEqual(['Alpha', 'Mid', 'Zebra'])
  })

  it('handles multiple projects in all groups', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Pinned', pinOrder: 0 }),
      makeProject({ id: 'p2', name: 'ProjectA', displayOrder: 0 }),
      makeProject({ id: 'p3', name: 'ProjectB', displayOrder: 1 }),
      makeProject({ id: 'p4', name: 'Archived', archivedAt: Date.now() })
    ]

    const result = groupProjects(projects)
    expect(result.pinned).toHaveLength(1)
    expect(result.projects).toHaveLength(2)
    expect(result.archived).toHaveLength(1)
  })

  it('handles empty projects array', () => {
    const result = groupProjects([])
    expect(result.pinned).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
    expect(result.archived).toHaveLength(0)
  })

  it('alphabetical sort is case-insensitive for archived', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'beta', archivedAt: Date.now() }),
      makeProject({ id: 'p2', name: 'Alpha', archivedAt: Date.now() }),
      makeProject({ id: 'p3', name: 'CHARLIE', archivedAt: Date.now() })
    ]

    const result = groupProjects(projects)
    expect(result.archived.map((p) => p.name)).toEqual(['Alpha', 'beta', 'CHARLIE'])
  })
})
