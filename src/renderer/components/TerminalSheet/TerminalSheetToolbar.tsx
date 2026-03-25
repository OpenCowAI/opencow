// SPDX-License-Identifier: Apache-2.0

/**
 * TerminalSheetToolbar — Terminal panel top toolbar (with integrated tab navigation + drag-to-reorder).
 *
 * Layout: [Terminal icon] [Tab Pills / Scope name] [+] --- [Close]
 *
 * Progressive disclosure:
 * - 0-1 tabs -> show scope name + subtle "+" button
 * - 2+ tabs -> show draggable tab pills (with X close button) + "+" button
 *
 * Naming convention: first tab is "zsh", subsequent same-shell tabs auto-number "zsh 2", "zsh 3", etc.
 */

import { useCallback, useState } from 'react'
import { X, Plus, Terminal as TerminalIcon, Minus } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '@/stores/appStore'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { cn } from '@/lib/utils'
import { getAppAPI } from '@/windowAPI'
import type { TerminalScope, TerminalTab } from '@shared/types'

// ─── Tab Naming Utilities ─────────────────────────────────────────────────────

/** Escape regex special characters */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compute the display name for a new tab (with sequential numbering to avoid duplicates).
 *
 * First tab: "zsh", subsequent: "zsh 2", "zsh 3", etc.
 * Closing a tab in the middle and creating a new one fills the gap (e.g. if "zsh 2" is closed, the next one is still "zsh 2").
 */
function nextTabDisplayName(existingTabs: TerminalTab[], shellBase: string): string {
  const hasSameBase = existingTabs.some(
    (t) => t.displayName === shellBase || t.displayName.startsWith(`${shellBase} `),
  )
  if (!hasSameBase) return shellBase // no conflict

  // Collect already-used numbers
  const usedNumbers = new Set<number>()
  const pattern = new RegExp(`^${escapeRegex(shellBase)} (\\d+)$`)
  for (const tab of existingTabs) {
    if (tab.displayName === shellBase) {
      usedNumbers.add(1)
    } else {
      const match = tab.displayName.match(pattern)
      if (match) usedNumbers.add(parseInt(match[1]))
    }
  }
  let n = 2
  while (usedNumbers.has(n)) n++
  return `${shellBase} ${n}`
}

// ─── SortableTab — Single draggable tab pill ──────────────────────────────

interface SortableTabProps {
  tab: TerminalTab
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
}

function SortableTab({ tab, isActive, onActivate, onClose }: SortableTabProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.terminalId })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={cn(
        'flex items-center gap-1 px-2 h-6 rounded-md text-[11px] cursor-pointer select-none shrink-0 transition-colors',
        isActive
          ? 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))]'
          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground)/0.8)]',
        isDragging && 'cursor-grabbing',
      )}
      onClick={onActivate}
    >
      <span className="truncate max-w-[100px]">{tab.displayName}</span>
      <button
        className="p-0.5 rounded hover:bg-[hsl(var(--foreground)/0.08)] transition-colors shrink-0"
        onClick={onClose}
        aria-label={`Close ${tab.displayName}`}
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── TabDragOverlay — Floating clone shown while dragging ────────────────────────────────

function TabDragOverlay({ tab }: { tab: TerminalTab }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-2 h-6 rounded-md text-[11px] bg-[hsl(var(--card))] shadow-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))] font-medium">
      <span className="truncate max-w-[100px]">{tab.displayName}</span>
    </div>
  )
}

// ─── TerminalSheetToolbar ─────────────────────────────────────────────

interface TerminalSheetToolbarProps {
  scope: TerminalScope
  scopeKey: string
  onClose: () => void
}

export function TerminalSheetToolbar({ scope, scopeKey, onClose }: TerminalSheetToolbarProps): React.JSX.Element {
  const projects = useAppStore((s) => s.projects)
  const tabGroup = useTerminalOverlayStore((s) => s.terminalTabGroups[scopeKey])
  const addTerminalTab = useTerminalOverlayStore((s) => s.addTerminalTab)
  const setActiveTerminalTab = useTerminalOverlayStore((s) => s.setActiveTerminalTab)
  const removeTerminalTab = useTerminalOverlayStore((s) => s.removeTerminalTab)
  const reorderTerminalTabs = useTerminalOverlayStore((s) => s.reorderTerminalTabs)
  const closeTerminalOverlay = useTerminalOverlayStore((s) => s.closeTerminalOverlay)

  const tabs = tabGroup?.tabs ?? []
  const activeTabId = tabGroup?.activeTabId ?? null

  const displayName = scope.type === 'global'
    ? '~'
    : projects.find((p) => p.id === scope.projectId)?.name ?? 'Terminal'

  // ── Create new tab (with sequential naming) ──
  const handleNewTab = async (): Promise<void> => {
    const api = getAppAPI()
    const info = await api['terminal:spawn']({ scope, cols: 80, rows: 24 })
    const shellBase = info.shell.split('/').pop() ?? 'terminal'
    const name = nextTabDisplayName(tabs, shellBase)
    addTerminalTab(scopeKey, { terminalId: info.id, displayName: name })
  }

  // ── Close tab ──
  const handleCloseTab = (terminalId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    getAppAPI()['terminal:kill'](terminalId)
    // Last tab -> close the panel (trigger exit animation)
    if (tabs.length === 1) {
      removeTerminalTab(scopeKey, terminalId)
      closeTerminalOverlay()
    } else {
      removeTerminalTab(scopeKey, terminalId)
    }
  }

  // ── DnD reordering ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const [dragActiveTab, setDragActiveTab] = useState<TerminalTab | null>(null)
  const sortableIds = tabs.map((t) => t.terminalId)

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const tab = tabs.find((t) => t.terminalId === event.active.id)
      setDragActiveTab(tab ?? null)
    },
    [tabs],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveTab(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = tabs.findIndex((t) => t.terminalId === active.id)
      const newIndex = tabs.findIndex((t) => t.terminalId === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(tabs, oldIndex, newIndex)
      reorderTerminalTabs(scopeKey, reordered.map((t) => t.terminalId))
    },
    [tabs, scopeKey, reorderTerminalTabs],
  )

  const handleDragCancel = useCallback(() => setDragActiveTab(null), [])

  const showTabPills = tabs.length > 1

  return (
    <div className="h-9 flex items-center px-3 gap-1.5 border-b border-[hsl(var(--border)/0.3)] bg-[hsl(var(--card)/0.5)] shrink-0 overflow-hidden">
      <TerminalIcon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />

      {showTabPills ? (
        /* ── Multi-tab mode: draggable tab pills ── */
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            <div className="flex items-center gap-0.5 overflow-x-auto min-w-0">
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.terminalId}
                  tab={tab}
                  isActive={tab.terminalId === activeTabId}
                  onActivate={() => setActiveTerminalTab(scopeKey, tab.terminalId)}
                  onClose={(e) => handleCloseTab(tab.terminalId, e)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
            {dragActiveTab ? <TabDragOverlay tab={dragActiveTab} /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        /* ── Single tab mode: scope name ── */
        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate min-w-0">
          {displayName}
        </span>
      )}

      {/* New tab button */}
      <button
        onClick={handleNewTab}
        className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted)/0.5)] transition-colors shrink-0"
        aria-label="New terminal tab"
      >
        <Plus className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
      </button>

      <div className="flex-1" />

      {/* Collapse panel */}
      <button
        onClick={onClose}
        className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted)/0.5)] transition-colors shrink-0"
        aria-label="Collapse terminal"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
