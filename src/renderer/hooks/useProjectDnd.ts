// SPDX-License-Identifier: Apache-2.0

import { useCallback, useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragStartEvent, DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import type { Project, ProjectGroup, GroupedProjects } from '@shared/types'
import { useAppStore } from '@/stores/appStore'

// ── Public Types ────────────────────────────────────────────────────────────

export interface ProjectDndState {
  /** The project currently being dragged (null when idle). */
  activeProject: Project | null
  /** The source group the dragged item originated from. */
  sourceGroup: ProjectGroup | null
  /** The target group the dragged item is currently hovering over. */
  overGroup: ProjectGroup | null
}

export interface UseProjectDndReturn {
  state: ProjectDndState
  onDragStart: (event: DragStartEvent) => void
  onDragOver: (event: DragOverEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
}

// ── Droppable container IDs ─────────────────────────────────────────────────

export const DROPPABLE_PINNED = 'droppable-pinned'
export const DROPPABLE_PROJECTS = 'droppable-projects'

function containerIdToGroup(id: string): ProjectGroup | null {
  if (id === DROPPABLE_PINNED) return 'pinned'
  if (id === DROPPABLE_PROJECTS) return 'projects'
  return null
}

// ── Hook ────────────────────────────────────────────────────────────────────

const IDLE_STATE: ProjectDndState = { activeProject: null, sourceGroup: null, overGroup: null }

export function useProjectDnd(grouped: GroupedProjects): UseProjectDndReturn {
  const reorderProjects = useAppStore((s) => s.reorderProjects)
  const reorderPinnedProjects = useAppStore((s) => s.reorderPinnedProjects)
  const pinProject = useAppStore((s) => s.pinProject)
  const unpinProject = useAppStore((s) => s.unpinProject)

  const [state, setState] = useState<ProjectDndState>(IDLE_STATE)

  /**
   * Find which group a project belongs to by its ID.
   */
  const findProject = useCallback(
    (id: string): { project: Project; group: ProjectGroup } | null => {
      for (const p of grouped.pinned) {
        if (p.id === id) return { project: p, group: 'pinned' }
      }
      for (const p of grouped.projects) {
        if (p.id === id) return { project: p, group: 'projects' }
      }
      return null
    },
    [grouped]
  )

  // ── DragStart ──

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const found = findProject(String(event.active.id))
      if (!found) return
      setState({
        activeProject: found.project,
        sourceGroup: found.group,
        overGroup: found.group,
      })
    },
    [findProject]
  )

  // ── DragOver ──
  // Updates overGroup for visual drop indicator.

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event
      if (!over) {
        setState((prev) => ({ ...prev, overGroup: null }))
        return
      }

      // Over a container directly
      const containerId = String(over.id)
      const containerGroup = containerIdToGroup(containerId)
      if (containerGroup) {
        setState((prev) => ({ ...prev, overGroup: containerGroup }))
        return
      }

      // Over another project item — resolve its group
      const overProject = findProject(containerId)
      if (overProject) {
        setState((prev) => ({ ...prev, overGroup: overProject.group }))
      }
    },
    [findProject]
  )

  // ── DragEnd ──
  // Handles same-group reorder and cross-group pin/unpin.

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setState(IDLE_STATE)

      if (!over || active.id === over.id) return

      const activeId = String(active.id)
      const overId = String(over.id)

      const sourceInfo = findProject(activeId)
      if (!sourceInfo) return

      // Determine target group: container ID or sibling project's group
      let targetGroup: ProjectGroup | null = containerIdToGroup(overId)

      if (!targetGroup) {
        const targetProject = findProject(overId)
        targetGroup = targetProject?.group ?? null
      }

      if (!targetGroup) return

      const sourceGroup = sourceInfo.group

      if (sourceGroup === targetGroup) {
        // ── Same-group reorder ──
        const list = sourceGroup === 'pinned' ? [...grouped.pinned] : [...grouped.projects]
        const oldIdx = list.findIndex((p) => p.id === activeId)
        const newIdx = list.findIndex((p) => p.id === overId)
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

        const reordered = arrayMove(list, oldIdx, newIdx)
        const ids = reordered.map((p) => p.id)

        if (sourceGroup === 'pinned') {
          reorderPinnedProjects(ids)
        } else {
          reorderProjects(ids)
        }
      } else if (sourceGroup === 'projects' && targetGroup === 'pinned') {
        // ── Projects → Pinned: auto-pin ──
        void pinProject(activeId)
      } else if (sourceGroup === 'pinned' && targetGroup === 'projects') {
        // ── Pinned → Projects: auto-unpin ──
        void unpinProject(activeId)
      }
    },
    [grouped, findProject, reorderProjects, reorderPinnedProjects, pinProject, unpinProject]
  )

  // ── DragCancel ──

  const onDragCancel = useCallback(() => setState(IDLE_STATE), [])

  return { state, onDragStart, onDragOver, onDragEnd, onDragCancel }
}
