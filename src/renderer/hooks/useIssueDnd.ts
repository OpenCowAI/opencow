// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo } from 'react'
import type { DragStartEvent, DragEndEvent, DragOverEvent, Announcements } from '@dnd-kit/core'
import { useIssueStore } from '../stores/issueStore'
import { validateSetParent } from '@shared/issueValidation'
import { isUnparentDroppable } from '../constants/droppableIds'
import type { IssueSummary } from '@shared/types'
import { createLogger } from '@/lib/logger'

const log = createLogger('DnD')

export interface IssueDndState {
  /** The issue currently being dragged, or null. */
  activeIssue: IssueSummary | null
  /** The droppable ID currently being hovered during drag. */
  overTargetId: string | null
}

export interface UseIssueDndReturn extends IssueDndState {
  handleDragStart: (event: DragStartEvent) => void
  handleDragOver: (event: DragOverEvent) => void
  handleDragEnd: (event: DragEndEvent) => void
  handleDragCancel: () => void
  /** Screen reader announcements for DnD accessibility. */
  announcements: Announcements
  /** Check whether dropping active issue onto the given target is valid. */
  validateDropTarget: (targetId: string) => boolean
}

export function useIssueDnd(issues: IssueSummary[]): UseIssueDndReturn {
  const [activeIssue, setActiveIssue] = useState<IssueSummary | null>(null)
  const [overTargetId, setOverTargetId] = useState<string | null>(null)
  const updateIssue = useIssueStore((s) => s.updateIssue)

  // Build lookup map for validation
  const issueMap = useMemo(() => {
    const map = new Map<string, IssueSummary>()
    for (const issue of issues) {
      map.set(issue.id, issue)
    }
    return map
  }, [issues])

  /** Build SetParentInput for validateSetParent from the current issue map. */
  const buildSetParentInput = useCallback(
    (sourceId: string, targetId: string) => ({
      sourceId,
      targetId,
      source: issueMap.get(sourceId) ?? null,
      target: issueMap.get(targetId) ?? null,
      sourceHasChildren: issues.some((i) => i.parentIssueId === sourceId)
    }),
    [issueMap, issues]
  )

  const validateDropTarget = useCallback(
    (targetId: string): boolean => {
      if (!activeIssue) return false
      // Any unparent zone (top zone or gap) is valid only for child issues
      if (isUnparentDroppable(targetId)) {
        return activeIssue.parentIssueId !== null
      }
      return validateSetParent(buildSetParentInput(activeIssue.id, targetId)).valid
    },
    [activeIssue, buildSetParentInput]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const issue = issueMap.get(String(event.active.id))
    setActiveIssue(issue ?? null)
  }, [issueMap])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverTargetId(event.over ? String(event.over.id) : null)
  }, [])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveIssue(null)
    setOverTargetId(null)

    if (!over) return

    const sourceId = String(active.id)
    const targetId = String(over.id)

    // Handle unparent operation (top zone or any gap zone)
    if (isUnparentDroppable(targetId)) {
      const source = issueMap.get(sourceId)
      if (source?.parentIssueId) {
        try {
          await updateIssue(sourceId, { parentIssueId: null })
        } catch (err) {
          log.error('Failed to unparent issue', err)
        }
      }
      return
    }

    // Handle set-parent operation
    if (sourceId === targetId) return

    const result = validateSetParent(buildSetParentInput(sourceId, targetId))
    if (!result.valid) return

    try {
      await updateIssue(sourceId, { parentIssueId: targetId })
    } catch (err) {
      log.error('Failed to set parent-child relationship', err)
    }
  }, [issueMap, buildSetParentInput, updateIssue])

  const handleDragCancel = useCallback(() => {
    setActiveIssue(null)
    setOverTargetId(null)
  }, [])

  // Screen reader announcements for DnD accessibility
  const announcements: Announcements = useMemo(() => ({
    onDragStart({ active }) {
      const issue = issueMap.get(String(active.id))
      return `Picked up issue: ${issue?.title ?? active.id}. Use arrow keys to move over a target issue.`
    },
    onDragOver({ active, over }) {
      if (!over) return 'Issue is not over a drop target.'

      const activeTitle = issueMap.get(String(active.id))?.title ?? active.id

      if (isUnparentDroppable(String(over.id))) {
        return `Over remove-from-parent zone. Release to make "${activeTitle}" a top-level issue.`
      }

      const overTitle = issueMap.get(String(over.id))?.title ?? over.id
      const result = validateSetParent(
        buildSetParentInput(String(active.id), String(over.id))
      )
      if (result.valid) {
        return `Over "${overTitle}". Release to make "${activeTitle}" a sub-issue.`
      }
      return `Cannot make "${activeTitle}" a sub-issue of "${overTitle}".`
    },
    onDragEnd({ active, over }) {
      if (!over) return 'Issue dropped. No changes made.'

      const activeTitle = issueMap.get(String(active.id))?.title ?? active.id

      if (isUnparentDroppable(String(over.id))) {
        return `"${activeTitle}" removed from parent.`
      }

      const overTitle = issueMap.get(String(over.id))?.title ?? over.id
      const result = validateSetParent(
        buildSetParentInput(String(active.id), String(over.id))
      )
      if (result.valid) {
        return `"${activeTitle}" is now a sub-issue of "${overTitle}".`
      }
      return 'Drop cancelled. No changes made.'
    },
    onDragCancel({ active }) {
      const issue = issueMap.get(String(active.id))
      return `Dragging cancelled. "${issue?.title}" returned to original position.`
    }
  }), [issueMap, buildSetParentInput])

  return {
    activeIssue,
    overTargetId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    announcements,
    validateDropTarget
  }
}
