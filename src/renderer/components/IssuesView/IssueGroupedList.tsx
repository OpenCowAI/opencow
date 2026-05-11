// SPDX-License-Identifier: Apache-2.0

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, Plus, SearchX, Sparkles } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAppStore, selectProjectId } from '../../stores/appStore'
import { useIssueStore, selectIssuesArray } from '../../stores/issueStore'
import { selectIssue, deleteIssue, setActiveView, setEphemeralFilters } from '../../actions/issueActions'
import { cn } from '../../lib/utils'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import {
  ISSUE_STATUS_THEME,
  ISSUE_PRIORITY_THEME
} from '../../constants/issueStatus'
import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import { DraggableIssueRow } from './DraggableIssueRow'
import { IssueGroup } from './IssueGroup'
import { IssueContextMenu } from './IssueContextMenu'
import { useIssueDndContext } from './IssueDndProvider'
import { ScrollToTopButton } from '../ui/ScrollToTopButton'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { IssueFormModal } from '../IssueForm/IssueFormModal'
import { IssueBatchToolbar } from './IssueBatchToolbar'
import { ALL_VIEW, isIssueUnread } from '@shared/types'
import type {
  IssueSummary,
  IssueStatus,
  IssuePriority,
} from '@shared/types'
import type { ChildStatusCounts, DisplayEntry } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3
}

function computeChildStatusCounts(children: IssueSummary[]): ChildStatusCounts {
  const counts: ChildStatusCounts = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    done: 0,
    cancelled: 0
  }
  for (const child of children) {
    counts[child.status]++
  }
  return counts
}

type IssueVirtuosoListProps = React.ComponentPropsWithoutRef<'div'>

// Keep horizontal padding on Virtuoso List (not Scroller):
// Scroller padding + Virtuoso viewport width:100% can trigger horizontal overflow.
const IssueVirtuosoList = forwardRef<HTMLDivElement, IssueVirtuosoListProps>(
  function IssueVirtuosoList({ style, ...props }, ref) {
    return (
      <div
        ref={ref}
        style={{ ...style, paddingLeft: '0.25rem', paddingRight: '0.25rem' }}
        {...props}
      />
    )
  },
)

const ISSUE_VIRTUOSO_COMPONENTS = {
  List: IssueVirtuosoList,
} as const

/**
 * Build flat display entries from a list of issues.
 * Handles parent-child interleaving and collapse state.
 */
function buildDisplayEntries(
  issues: IssueSummary[],
  collapsedParents: Set<string>,
  sortFn: (a: IssueSummary, b: IssueSummary) => number
): DisplayEntry[] {
  const topLevel = issues.filter((i) => !i.parentIssueId)
  const childMap = new Map<string, IssueSummary[]>()
  for (const issue of issues) {
    if (issue.parentIssueId) {
      const children = childMap.get(issue.parentIssueId) ?? []
      children.push(issue)
      childMap.set(issue.parentIssueId, children)
    }
  }

  topLevel.sort(sortFn)

  const result: DisplayEntry[] = []
  for (const parent of topLevel) {
    const children = childMap.get(parent.id) ?? []
    const childStatusCounts = children.length > 0 ? computeChildStatusCounts(children) : null
    result.push({
      issue: parent,
      isChild: false,
      childCount: children.length,
      childStatusCounts,
      isPinnedSection: false
    })

    if (children.length > 0 && !collapsedParents.has(parent.id)) {
      const sortedChildren = [...children].sort(sortFn)
      for (const child of sortedChildren) {
        result.push({
          issue: child,
          isChild: true,
          childCount: 0,
          childStatusCounts: null,
          isPinnedSection: false
        })
      }
    }
  }

  // Include orphan children (whose parent wasn't in this slice).
  // Children whose parent IS in this slice but collapsed are intentionally
  // hidden — they are not orphans and must be skipped.
  const shownIds = new Set(result.map((e) => e.issue.id))
  const topLevelIds = new Set(topLevel.map((i) => i.id))
  for (const issue of issues) {
    if (!shownIds.has(issue.id)) {
      if (
        issue.parentIssueId &&
        topLevelIds.has(issue.parentIssueId) &&
        collapsedParents.has(issue.parentIssueId)
      ) {
        continue
      }
      result.push({
        issue,
        isChild: !!issue.parentIssueId,
        childCount: 0,
        childStatusCounts: null,
        isPinnedSection: false
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

interface GroupedIssues {
  key: string
  label: string
  labelKey?: string
  icon?: React.ReactNode
  accentColor?: string
  issues: IssueSummary[]
}

const STATUS_ORDER: IssueStatus[] = ['in_progress', 'todo', 'backlog', 'done', 'cancelled']

function groupByStatus(issues: IssueSummary[]): GroupedIssues[] {
  const groups = new Map<IssueStatus, IssueSummary[]>()
  for (const issue of issues) {
    const list = groups.get(issue.status) ?? []
    list.push(issue)
    groups.set(issue.status, list)
  }
  return STATUS_ORDER
    .filter((s) => groups.has(s))
    .map((status) => ({
      key: status,
      label: ISSUE_STATUS_THEME[status].label,
      labelKey: `issueStatus.${status === 'in_progress' ? 'inProgress' : status}`,
      icon: <IssueStatusIcon status={status} className="w-3.5 h-3.5" />,
      accentColor: ISSUE_STATUS_THEME[status].color,
      issues: groups.get(status)!
    }))
}

const PRIORITY_SORT_ORDER: IssuePriority[] = ['urgent', 'high', 'medium', 'low']

function groupByPriority(issues: IssueSummary[]): GroupedIssues[] {
  const groups = new Map<IssuePriority, IssueSummary[]>()
  for (const issue of issues) {
    const list = groups.get(issue.priority) ?? []
    list.push(issue)
    groups.set(issue.priority, list)
  }
  return PRIORITY_SORT_ORDER
    .filter((p) => groups.has(p))
    .map((priority) => ({
      key: priority,
      label: ISSUE_PRIORITY_THEME[priority].label,
      labelKey: `priority.${priority}`,
      icon: <IssuePriorityIcon priority={priority} />,
      accentColor: ISSUE_PRIORITY_THEME[priority].color,
      issues: groups.get(priority)!
    }))
}

function groupByLabel(issues: IssueSummary[]): GroupedIssues[] {
  const groups = new Map<string, IssueSummary[]>()
  const noLabel: IssueSummary[] = []
  for (const issue of issues) {
    if (issue.labels.length === 0) {
      noLabel.push(issue)
    } else {
      // An issue with multiple labels appears in each group
      for (const label of issue.labels) {
        const list = groups.get(label) ?? []
        list.push(issue)
        groups.set(label, list)
      }
    }
  }
  const result: GroupedIssues[] = []
  const sortedLabels = Array.from(groups.keys()).sort()
  for (const label of sortedLabels) {
    result.push({ key: label, label, issues: groups.get(label)! })
  }
  if (noLabel.length > 0) {
    result.push({ key: '__none__', label: 'No label', labelKey: '__noLabel__', issues: noLabel })
  }
  return result
}

function groupByProject(issues: IssueSummary[], projectNames: Map<string, string>): GroupedIssues[] {
  const groups = new Map<string | null, IssueSummary[]>()
  for (const issue of issues) {
    const key = issue.projectId
    const list = groups.get(key) ?? []
    list.push(issue)
    groups.set(key, list)
  }

  const result: GroupedIssues[] = []
  // Named projects first
  const projectIds = Array.from(groups.keys()).filter((k): k is string => k !== null)
  projectIds.sort((a, b) => (projectNames.get(a) ?? a).localeCompare(projectNames.get(b) ?? b))
  for (const pid of projectIds) {
    result.push({
      key: pid,
      label: projectNames.get(pid) ?? pid,
      issues: groups.get(pid)!
    })
  }
  // No project group last
  const noProject = groups.get(null)
  if (noProject) {
    result.push({ key: '__none__', label: 'No project', labelKey: '__noProject__', issues: noProject })
  }
  return result
}

// ---------------------------------------------------------------------------
// IssueGroupedList
// ---------------------------------------------------------------------------

interface IssueGroupedListProps {
  /** Opens the manual create-issue modal — wired from `IssuesView`'s
   *  toolbar handler so the empty state's "Create task" CTA shares the
   *  same entry point as the `+` button in the header. */
  onCreateIssue?: () => void
  /** Opens the AI Issue Creator modal — same rationale as `onCreateIssue`. */
  onAICreateIssue?: () => void
}

export function IssueGroupedList({ onCreateIssue, onAICreateIssue }: IssueGroupedListProps = {}): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { t: tc } = useTranslation('common')
  const issues = useIssueStore(selectIssuesArray)
  const issueViews = useIssueStore((s) => s.issueViews)
  const activeViewId = useAppStore((s) => s.activeViewId)
  const selectedIssueId = useAppStore((s) => s.selectedIssueId)
  const prefetchIssueDetail = useIssueStore((s) => s.prefetchIssueDetail)
  const projects = useAppStore((s) => s.projects)
  const sidebarProjectId = useAppStore(selectProjectId)

  // NOTE: `managedSessions` and `noteCountsByIssue` are NO LONGER subscribed here.
  // Each IssueRow self-subscribes to its own session state and note count via
  // `useIssueSessionContext` and `useAppStore((s) => s.noteCountsByIssue[id])`.
  // This eliminates the cascade: session state change → parent re-render → N rows checked.

  const allViewDisplay = useAppStore((s) => s.allViewDisplay)

  const isAllView = activeViewId === ALL_VIEW.id
  const activeView = isAllView
    ? ALL_VIEW
    : issueViews.find((v) => v.id === activeViewId) ?? ALL_VIEW

  // All view uses in-memory allViewDisplay; custom views use persisted display
  const currentDisplay = isAllView ? allViewDisplay : activeView.display
  const groupBy = currentDisplay.groupBy
  const sortConfig = currentDisplay.sort

  // DnD context — suppress context menu during active drag
  const { activeIssue: dndActiveIssue } = useIssueDndContext()

  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set())
  const listContainerRef = useRef<HTMLDivElement>(null)

  // ── Multi-select state ────────────────────────────────────────────
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set())

  const toggleMultiSelect = useCallback((id: string, e: React.MouseEvent) => {
    // Cmd/Ctrl+Click toggles individual selection
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      setMultiSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
      return true // signals that multi-select handled the click
    }
    return false
  }, [])

  const clearMultiSelection = useCallback(() => {
    setMultiSelectedIds(new Set())
  }, [])

  // (Scroll-to-top on view change is handled below in the Virtuoso section)

  // --- Context menu state ---
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; issue: IssueSummary } | null>(null)
  const [deleteTargetIssue, setDeleteTargetIssue] = useState<IssueSummary | null>(null)
  const [editTargetIssueId, setEditTargetIssueId] = useState<string | null>(null)
  const [createSubIssueParentId, setCreateSubIssueParentId] = useState<string | null>(null)

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, issue: IssueSummary) => {
      if (dndActiveIssue) return // suppress during active drag
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, issue })
    },
    [dndActiveIssue]
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleRequestDelete = useCallback((issue: IssueSummary) => {
    setContextMenu(null)
    setDeleteTargetIssue(issue)
  }, [])

  const handleRequestEdit = useCallback((issue: IssueSummary) => {
    setContextMenu(null)
    setEditTargetIssueId(issue.id)
  }, [])

  const handleRequestAddSubIssue = useCallback((issue: IssueSummary) => {
    setContextMenu(null)
    setCreateSubIssueParentId(issue.id)
  }, [])

  const handleSelectIssue = useCallback((id: string) => selectIssue(id), [])

  const toggleCollapse = useCallback((parentId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }, [])

  // Sort comparator
  const sortFn = useCallback(
    (a: IssueSummary, b: IssueSummary): number => {
      if (sortConfig.field === 'priority') {
        const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        return sortConfig.order === 'asc' ? diff : -diff
      }
      const aVal = a[sortConfig.field] as number
      const bVal = b[sortConfig.field] as number
      return sortConfig.order === 'asc' ? aVal - bVal : bVal - aVal
    },
    [sortConfig]
  )

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  )

  const getProjectName = useCallback(
    (projectId: string | null): string | null => {
      if (!projectId) return null
      return projectNames.get(projectId) ?? null
    },
    [projectNames]
  )

  // Build grouped or flat entries
  const groupedData = useMemo((): GroupedIssues[] | null => {
    if (!groupBy) return null

    switch (groupBy) {
      case 'status':
        return groupByStatus(issues)
      case 'priority':
        return groupByPriority(issues)
      case 'label':
        return groupByLabel(issues)
      case 'project':
        return groupByProject(issues, projectNames)
    }
  }, [issues, groupBy, projectNames])

  // Flat mode entries
  const flatEntries = useMemo((): DisplayEntry[] => {
    if (groupBy) return []
    return buildDisplayEntries(issues, collapsedParents, sortFn)
  }, [issues, groupBy, collapsedParents, sortFn])

  // --- Virtuoso refs (declared early — used by keyboard nav below) ---
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const virtuosoScrollerRef = useRef<HTMLElement | null>(null)

  // For keyboard nav
  const flatIssues = useMemo(() => {
    if (groupBy && groupedData) {
      return groupedData.flatMap((g) => g.issues)
    }
    return flatEntries.map((e) => e.issue)
  }, [groupBy, groupedData, flatEntries])

  // Virtuoso scroll strategy for flat mode — delegates to Virtuoso's
  // scrollToIndex API instead of DOM querySelector (off-screen virtualized
  // items don't exist in the DOM).
  const scrollToItemVirtuoso = useCallback((_id: string, index: number) => {
    virtuosoRef.current?.scrollToIndex({ index, behavior: 'auto', align: 'center' })
  }, [])

  // Unified keyboard navigation: single hook handles both flat (Virtuoso)
  // and grouped (standard DOM) modes via the scroll strategy injection.
  useListKeyboardNav({
    items: flatIssues,
    selectedId: selectedIssueId,
    onSelect: handleSelectIssue,
    ...(groupBy
      ? { containerRef: listContainerRef }
      : { scrollToItem: scrollToItemVirtuoso }),
  })

  // --- Render helpers ---

  /**
   * Shared entry renderer for both flat (Virtuoso) and grouped modes.
   *
   * Design note: creates new `selection`, `hierarchy`, `context` prop objects
   * and inline closures on every call. This is intentional — DraggableIssueRow's
   * custom `arePropsEqual` compares only DATA fields (not callbacks), so rows
   * whose data hasn't changed won't re-render despite new object references.
   * In flat mode, Virtuoso further limits this to ~20-30 visible items.
   */
  const renderIssueEntry = (entry: DisplayEntry): React.JSX.Element => {
    const isMultiSelected = multiSelectedIds.has(entry.issue.id)
    return (
      <div
        key={entry.issue.id}
        data-item-id={entry.issue.id}
        data-issue-row=""
      >
        <DraggableIssueRow
          issue={entry.issue}
          selection={{
            isSelected: selectedIssueId === entry.issue.id || isMultiSelected,
            onSelect: (e?: React.MouseEvent) => {
              if (e && toggleMultiSelect(entry.issue.id, e)) return
              // Normal click: clear multi-select and do normal selection
              if (multiSelectedIds.size > 0) clearMultiSelection()
              selectIssue(entry.issue.id)
            },
            onContextMenu: (e) => handleContextMenu(e, entry.issue),
            onPrefetch: () => prefetchIssueDetail(entry.issue.id),
          }}
          hierarchy={{
            isChild: entry.isChild,
            childCount: entry.childCount,
            childStatusCounts: entry.childStatusCounts,
            isCollapsed: collapsedParents.has(entry.issue.id),
            onToggleCollapse: () => toggleCollapse(entry.issue.id)
          }}
          context={{
            projectName: sidebarProjectId ? null : getProjectName(entry.issue.projectId),
            isUnread: isIssueUnread(entry.issue),
          }}
        />
      </div>
    )
  }

  // Render a single group's issues as flat display entries (grouped mode only)
  const renderGroupIssues = (groupIssues: IssueSummary[]): React.JSX.Element[] => {
    const entries = buildDisplayEntries(groupIssues, collapsedParents, sortFn)
    return entries.map((entry) => renderIssueEntry(entry))
  }

  // --- Virtuoso for flat mode ---

  // Virtuoso itemContent callback — renders a single entry by index.
  // Not wrapped in useCallback because DraggableIssueRow's arePropsEqual
  // memo already prevents unchanged rows from re-rendering.
  const flatItemContent = (_index: number, entry: DisplayEntry): React.JSX.Element =>
    renderIssueEntry(entry)

  // Stable item key for Virtuoso — tracks items by issue ID across data changes
  const computeItemKey = useCallback((_index: number, entry: DisplayEntry) => entry.issue.id, [])

  // Scroll to top on view change — use Virtuoso ref for flat mode
  useEffect(() => {
    if (!groupBy) {
      virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' })
    } else {
      listContainerRef.current?.scrollTo({ top: 0 })
    }
  }, [activeViewId, groupBy])

  // Provide scroller ref for ScrollToTopButton
  const handleVirtuosoScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    virtuosoScrollerRef.current = (el as HTMLElement) ?? null
  }, [])

  // --- Context menu + modals overlay (shared by grouped and flat mode) ---
  //
  // Narrow reactive selectors for modal default values.
  // These only subscribe to the specific issue's projectId — not the entire
  // issueById map — so store mutations for other issues won't trigger re-renders.
  //
  // NOTE: These hooks MUST be called before any early return to satisfy the
  // Rules of Hooks (same hooks in same order on every render).
  const editTargetProjectId = useIssueStore((s) =>
    editTargetIssueId ? s.issueById[editTargetIssueId]?.projectId ?? null : null
  )
  const createSubIssueProjectId = useIssueStore((s) =>
    createSubIssueParentId ? s.issueById[createSubIssueParentId]?.projectId ?? null : null
  )

  // --- Empty state ---
  if (issues.length === 0) {
    return (
      <div ref={listContainerRef} className="flex-1 min-h-0 flex">
        <EmptyState
          onCreateIssue={onCreateIssue}
          onAICreateIssue={onAICreateIssue}
        />
      </div>
    )
  }

  const contextMenuOverlay = (
    <>
      {contextMenu && (
        <IssueContextMenu
          issue={contextMenu.issue}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
          onEdit={() => handleRequestEdit(contextMenu.issue)}
          onAddSubIssue={() => handleRequestAddSubIssue(contextMenu.issue)}
          onRequestDelete={() => handleRequestDelete(contextMenu.issue)}
        />
      )}

      <ConfirmDialog
        open={deleteTargetIssue !== null}
        title={t('deleteIssue')}
        message={t('deleteIssueConfirm', { title: deleteTargetIssue?.title ?? '' })}
        confirmLabel={tc('delete')}
        variant="destructive"
        onConfirm={async () => {
          if (deleteTargetIssue) await deleteIssue(deleteTargetIssue.id)
          setDeleteTargetIssue(null)
        }}
        onCancel={() => setDeleteTargetIssue(null)}
      />

      {editTargetIssueId && (
        <IssueFormModal
          issueId={editTargetIssueId}
          defaultProjectId={editTargetProjectId}
          onClose={() => setEditTargetIssueId(null)}
        />
      )}

      {createSubIssueParentId && (
        <IssueFormModal
          parentIssueId={createSubIssueParentId}
          defaultProjectId={createSubIssueProjectId}
          onClose={() => setCreateSubIssueParentId(null)}
        />
      )}
    </>
  )

  // --- Flat mode: virtualized with react-virtuoso ---
  if (!groupBy) {
    return (
      // `px-3` (combined with `IssueRow`'s own `px-3`) puts row content
      // ~24 px from the panel edge — slightly *more* inset than the
      // toolbar above (16 px), so rows read as visually nested children
      // of the toolbar rather than fighting for the same vertical rail.
      <div className="relative flex-1 min-h-0 py-1 px-3">
        <Virtuoso
          ref={virtuosoRef}
          data={flatEntries}
          computeItemKey={computeItemKey}
          itemContent={flatItemContent}
          scrollerRef={handleVirtuosoScrollerRef}
          increaseViewportBy={{ top: 400, bottom: 200 }}
          className="h-full"
          style={{ height: '100%' }}
          components={ISSUE_VIRTUOSO_COMPONENTS}
        />
        {contextMenuOverlay}
        <ScrollToTopButton containerRef={virtuosoScrollerRef as React.RefObject<HTMLElement>} />
        <IssueBatchToolbar selectedIds={multiSelectedIds} onClearSelection={clearMultiSelection} />
      </div>
    )
  }

  // --- Grouped mode: standard rendering (groups are small, virtualization adds little benefit) ---
  const groupedContent = groupedData
    ? groupedData.map((group) => {
        let resolvedLabel = group.label
        if (group.labelKey === '__noLabel__') resolvedLabel = t('noLabel')
        else if (group.labelKey === '__noProject__') resolvedLabel = t('noProject')
        else if (group.labelKey) resolvedLabel = tc(group.labelKey)
        return (
          <IssueGroup
            key={group.key}
            label={resolvedLabel}
            icon={group.icon}
            count={group.issues.length}
            accentColor={group.accentColor}
          >
            {renderGroupIssues(group.issues)}
          </IssueGroup>
        )
      })
    : null

  return (
    <div className="relative flex-1 min-h-0">
      {/* `px-3` keeps grouped-mode row insets in lock-step with the
          flat-mode wrapper above — ~24 px from the panel edge in both
          modes, so the list left/right rails don't shift when the user
          toggles groupBy. */}
      <div ref={listContainerRef} className="h-full overflow-y-auto py-1 px-3">
        {groupedContent}
        {contextMenuOverlay}
      </div>

      <ScrollToTopButton containerRef={listContainerRef} />
      <IssueBatchToolbar selectedIds={multiSelectedIds} onClearSelection={clearMultiSelection} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
//
// Two visual modes share the same wrapper so the empty surface feels like
// a single, coherent design language regardless of cause:
//
//   - `noneYet`  : no issues exist in the current project scope at all.
//                  Encourages creation via the manual + AI entry points.
//   - `filtered` : issues exist but the active view / ephemeral filters
//                  hide everything.  Offers one-click recovery
//                  (clear filters, switch to All) instead of leaving the
//                  user to hunt the filter chrome.
//
// "Truly empty" is detected via `viewIssueCounts[ALL_VIEW.id]` — the
// unfiltered all-view count under the current project scope.  When that
// count hasn't loaded yet (mount race) we fall back to "noneYet" so the
// initial paint encourages action rather than blaming filters.
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  onCreateIssue?: () => void
  onAICreateIssue?: () => void
}

function EmptyState({ onCreateIssue, onAICreateIssue }: EmptyStateProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const activeViewId = useAppStore((s) => s.activeViewId)
  const ephemeralFilters = useAppStore((s) => s.ephemeralFilters)
  const allViewCount = useIssueStore((s) => s.viewIssueCounts[ALL_VIEW.id] ?? 0)

  // "Filtered to zero" only makes sense when there *are* issues to filter
  // and the user has either picked a non-All view or has ephemeral filters
  // active.  Otherwise the surface is genuinely fresh.
  const hasFilters =
    activeViewId !== ALL_VIEW.id || Object.keys(ephemeralFilters).length > 0
  const mode: 'noneYet' | 'filtered' = allViewCount > 0 && hasFilters ? 'filtered' : 'noneYet'

  const handleClearFilters = useCallback(() => {
    if (Object.keys(ephemeralFilters).length > 0) setEphemeralFilters({})
  }, [ephemeralFilters])

  const handleSwitchToAll = useCallback(() => {
    setActiveView(ALL_VIEW.id)
  }, [])

  if (mode === 'filtered') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center text-[hsl(var(--muted-foreground))]">
        {/* Plain icon @ 30% opacity, no surrounding chip — matches the
            minimalism used by the Schedule view's empty state so both
            surfaces feel cut from the same cloth. */}
        <SearchX className="h-12 w-12 opacity-30" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
            {t('emptyState.filtered.title')}
          </h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-sm leading-relaxed">
            {t('emptyState.filtered.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {Object.keys(ephemeralFilters).length > 0 && (
            <button
              type="button"
              onClick={handleClearFilters}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium',
                'border border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
                'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              )}
            >
              {t('emptyState.filtered.clearCta')}
            </button>
          )}
          {activeViewId !== ALL_VIEW.id && (
            <button
              type="button"
              onClick={handleSwitchToAll}
              className={cn(
                'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                'hover:bg-[hsl(var(--primary)/0.9)] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              )}
            >
              {t('emptyState.filtered.allViewCta')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center text-[hsl(var(--muted-foreground))]">
      {/* Plain icon @ 30% opacity, no surrounding chip — matches the
          minimalism used by the Schedule view's empty state so both
          surfaces feel cut from the same cloth. */}
      <ListChecks className="h-12 w-12 opacity-30" aria-hidden="true" />
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
          {t('emptyState.noneYet.title')}
        </h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-sm leading-relaxed">
          {t('emptyState.noneYet.subtitle')}
        </p>
      </div>
      {(onCreateIssue || onAICreateIssue) && (
        <div className="flex items-center gap-2 mt-1">
          {onCreateIssue && (
            <button
              type="button"
              onClick={onCreateIssue}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                'hover:bg-[hsl(var(--primary)/0.9)] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              )}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              {t('emptyState.noneYet.createCta')}
            </button>
          )}
          {onAICreateIssue && (
            <button
              type="button"
              onClick={onAICreateIssue}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
                'text-[hsl(var(--ai))] hover:bg-[hsl(var(--ai)/0.1)] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              )}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              {t('emptyState.noneYet.aiCta')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
