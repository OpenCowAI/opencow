// SPDX-License-Identifier: Apache-2.0

import type { IssueSummary, IssueStatus } from '@shared/types'

/** Status breakdown of child issues for a parent issue. */
export type ChildStatusCounts = Record<IssueStatus, number>

/** Entry in the flattened display list with hierarchy metadata. */
export interface DisplayEntry {
  issue: IssueSummary
  isChild: boolean
  childCount: number
  /** Status breakdown of child issues (null when childCount is 0). */
  childStatusCounts: ChildStatusCounts | null
  /** Whether this entry belongs to the "in progress" pinned section at the top. */
  isPinnedSection: boolean
}

/**
 * Structured props for IssueRow — groups related concerns instead of flat params.
 *
 * Design note: `sessionState`, `sessionActiveDuration`, and `noteCount` are NOT
 * passed as props.  Instead, each row subscribes to its own data via narrow
 * Zustand selectors (component-level subscription pattern).  This prevents
 * the parent list from re-rendering when a single session's state changes.
 */
export interface IssueRowProps {
  issue: IssueSummary
  /** Selection state */
  selection: {
    isSelected: boolean
    onSelect: () => void
    onContextMenu?: (e: React.MouseEvent) => void
    /** Pre-fetch detail data on hover for instant switching. */
    onPrefetch?: () => void
  }
  /** Hierarchy metadata */
  hierarchy: {
    isChild: boolean
    childCount: number
    /** Status breakdown of child issues (null when childCount is 0). */
    childStatusCounts: ChildStatusCounts | null
    isCollapsed: boolean
    onToggleCollapse: () => void
  }
  /** Contextual display data */
  context: {
    projectName: string | null
    /** Whether the issue has unread agent activity. */
    isUnread: boolean
  }
  /** DnD visual state (optional — injected by DraggableIssueRow wrapper). */
  dndState?: IssueRowDndState
}

/** DnD visual state passed to IssueRow for CSS class computation. */
export interface IssueRowDndState {
  /** This row is currently being dragged */
  isDragging: boolean
  /** Something is being dragged over this row */
  isDropTarget: boolean
  /** The drop would be valid (determines highlight color) */
  isValidDrop: boolean
}
