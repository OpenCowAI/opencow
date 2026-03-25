// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { useIssueDnd, type IssueDndState } from '../../hooks/useIssueDnd'
import { DragOverlayContent } from './DragOverlayContent'
import type { IssueSummary } from '@shared/types'

// ---------- DnD state context ----------

interface IssueDndContextValue {
  /** The issue currently being dragged, or null. */
  activeIssue: IssueSummary | null
  /** Check whether the currently dragged issue can be dropped on a target. */
  validateDropTarget: (targetId: string) => boolean
}

const IssueDndStateContext = createContext<IssueDndContextValue>({
  activeIssue: null,
  validateDropTarget: () => false
})

/** Access DnD state from within IssueDndProvider. */
export function useIssueDndContext(): IssueDndContextValue {
  return useContext(IssueDndStateContext)
}

// ---------- Provider component ----------

interface IssueDndProviderProps {
  children: React.ReactNode
  issues: IssueSummary[]
}

/**
 * Wraps the issue list with @dnd-kit DndContext and exposes DnD state via React Context.
 *
 * DraggableIssueRow and UnparentDropZone consume DnD state through useIssueDndContext()
 * rather than prop drilling.
 *
 * Future extension: when adding drag-to-reorder, wrap children with
 * SortableContext from @dnd-kit/sortable inside this component.
 */
export function IssueDndProvider({ children, issues }: IssueDndProviderProps): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 8px movement before starting drag — prevents accidental drags on click
      activationConstraint: { distance: 8 }
    }),
    useSensor(KeyboardSensor)
    // KeyboardSensor provides full keyboard DnD support:
    // - Space/Enter to pick up
    // - Arrow keys to move over droppable targets
    // - Space/Enter to drop
    // - Escape to cancel
  )

  const {
    activeIssue,
    overTargetId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    announcements,
    validateDropTarget
  } = useIssueDnd(issues)

  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )

  // Only activeIssue + validateDropTarget are exposed to consumers.
  // overTargetId is intentionally excluded — it changes on every pointer-move
  // during drag, and broadcasting it through context would trigger O(N)
  // re-renders across all DraggableIssueRow instances.  Each row already
  // knows whether it is hovered via @dnd-kit's useDroppable `isOver`.
  const contextValue = useMemo<IssueDndContextValue>(
    () => ({ activeIssue, validateDropTarget }),
    [activeIssue, validateDropTarget]
  )

  return (
    <IssueDndStateContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'To pick up an issue, press space or enter. ' +
              'While dragging, use arrow keys to move over target issues. ' +
              'Press space or enter to drop and make it a sub-issue, or escape to cancel.'
          }
        }}
      >
        {children}
        <DragOverlay
          dropAnimation={
            prefersReducedMotion
              ? null
              : { duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }
          }
        >
          {activeIssue ? <DragOverlayContent issue={activeIssue} /> : null}
        </DragOverlay>
      </DndContext>
    </IssueDndStateContext.Provider>
  )
}
