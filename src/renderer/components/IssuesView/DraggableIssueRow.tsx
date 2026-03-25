// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { IssueRow } from './IssueRow'
import { useIssueDndContext } from './IssueDndProvider'
import type { IssueRowProps, IssueRowDndState } from './types'

type DraggableIssueRowProps = Omit<IssueRowProps, 'dndState'>

/**
 * Custom equality check for DraggableIssueRow's memo wrapper.
 *
 * Compares only DATA fields; callback references (onSelect, onContextMenu,
 * onPrefetch, onToggleCollapse) are intentionally skipped.
 *
 * Why this is safe:
 * - Callbacks close over the issue ID (compared via `issue` ref equality).
 * - When issue data changes, arePropsEqual returns false → component
 *   re-renders and receives fresh callbacks.
 * - When only callbacks change (parent re-render, same data), skipping the
 *   re-render is correct — old callbacks still reference the right data.
 *
 * Note: `sessionState`, `sessionActiveDuration`, and `noteCount` are NOT
 * compared here — they've been moved to self-subscribing sub-components
 * inside IssueRow (IssueSessionIndicator, IssueNoteCountBadge), so the
 * parent list no longer passes them as props.
 */
function arePropsEqual(
  prev: DraggableIssueRowProps,
  next: DraggableIssueRowProps,
): boolean {
  // Issue identity (referential — new object = new data from normalized store)
  if (prev.issue !== next.issue) return false

  // Selection state (data only — skip onSelect, onContextMenu, onPrefetch)
  if (prev.selection.isSelected !== next.selection.isSelected) return false

  // Hierarchy state (data only — skip onToggleCollapse)
  if (prev.hierarchy.isChild !== next.hierarchy.isChild) return false
  if (prev.hierarchy.childCount !== next.hierarchy.childCount) return false
  if (prev.hierarchy.childStatusCounts !== next.hierarchy.childStatusCounts) return false
  if (prev.hierarchy.isCollapsed !== next.hierarchy.isCollapsed) return false

  // Context display data
  if (prev.context.projectName !== next.context.projectName) return false
  if (prev.context.isUnread !== next.context.isUnread) return false

  return true
}

/**
 * Wraps IssueRow with @dnd-kit draggable + droppable behavior.
 * IssueRow itself remains a pure presentation component — all DnD state
 * is computed here and passed as dndState.
 *
 * Design: Each row is BOTH a drag source (can be picked up) AND a drop target
 * (can receive a drop to establish parent-child relationship).
 *
 * Wrapped in memo with custom arePropsEqual to prevent O(N) re-renders
 * when only a few rows' data has actually changed.
 *
 * Future extension: when adding drag-to-reorder, switch to useSortable()
 * from @dnd-kit/sortable instead of useDraggable() + useDroppable().
 */
export const DraggableIssueRow = memo(function DraggableIssueRow(props: DraggableIssueRowProps): React.JSX.Element {
  const { issue } = props
  const issueId = issue.id

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging
  } = useDraggable({
    id: issueId,
    data: { issue }
  })

  const {
    setNodeRef: setDropRef,
    isOver
  } = useDroppable({
    id: issueId,
    data: { issue }
  })

  // Access DnD state from provider context
  const { activeIssue, validateDropTarget } = useIssueDndContext()

  // Merge refs: same DOM element is both drag source and drop target
  const setNodeRef = (node: HTMLElement | null): void => {
    setDragRef(node)
    setDropRef(node)
  }

  // Compute DnD visual state for IssueRow
  const dndState: IssueRowDndState = {
    isDragging,
    isDropTarget: isOver && activeIssue !== null && activeIssue.id !== issueId,
    isValidDrop: isOver && activeIssue !== null ? validateDropTarget(issueId) : false
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}>
      <IssueRow {...props} dndState={dndState} />
    </div>
  )
}, arePropsEqual)
