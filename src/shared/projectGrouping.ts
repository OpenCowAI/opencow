// SPDX-License-Identifier: Apache-2.0

import type { Project, GroupedProjects } from './types'

/** Locale-aware name comparator for stable alphabetical ordering. */
const nameComparator = (a: Project, b: Project): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * Group projects into user-controlled categories with deterministic ordering.
 *
 * - pinned:   user-pinned projects, sorted by pinOrder (drag-to-reorder)
 * - projects: non-pinned, non-archived projects, sorted by displayOrder (drag-to-reorder)
 * - archived: user-archived projects, sorted alphabetically by name
 *
 * No session data dependency — grouping is purely based on project metadata.
 */
export function groupProjects(projects: Project[]): GroupedProjects {
  const result: GroupedProjects = { pinned: [], projects: [], archived: [] }
  const pinnedEntries: Array<{ project: Project; order: number }> = []

  for (const project of projects) {
    if (project.pinOrder !== null) {
      pinnedEntries.push({ project, order: project.pinOrder })
    } else if (project.archivedAt !== null) {
      result.archived.push(project)
    } else {
      result.projects.push(project)
    }
  }

  // Pinned: sort by pin_order ascending (preserves user drag ordering)
  pinnedEntries.sort((a, b) => a.order - b.order)
  result.pinned = pinnedEntries.map((e) => e.project)

  // Projects: sort by display_order ascending (user drag ordering)
  result.projects.sort((a, b) => a.displayOrder - b.displayOrder)

  // Archived: stable alphabetical order (low-frequency access, no drag needed)
  result.archived.sort(nameComparator)

  return result
}
