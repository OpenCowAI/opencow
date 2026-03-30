// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAppStore, selectProjectId } from '../../stores/appStore'
import { useIssueStore, selectIssuesArray } from '../../stores/issueStore'
import { selectIssue, deleteIssue } from '../../actions/issueActions'
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

export function IssueGroupedList(): React.JSX.Element {
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
    return (
      <div
        key={entry.issue.id}
        data-item-id={entry.issue.id}
      >
        <DraggableIssueRow
          issue={entry.issue}
          selection={{
            isSelected: selectedIssueId === entry.issue.id,
            onSelect: () => selectIssue(entry.issue.id),
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
      <div
        ref={listContainerRef}
        className="flex-1 flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm"
      >
        {t('noIssuesFound')}
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
      <div className="relative flex-1 min-h-0">
        <Virtuoso
          ref={virtuosoRef}
          data={flatEntries}
          computeItemKey={computeItemKey}
          itemContent={flatItemContent}
          scrollerRef={handleVirtuosoScrollerRef}
          increaseViewportBy={{ top: 400, bottom: 200 }}
          className="h-full px-1 py-1"
          style={{ height: '100%' }}
        />
        {contextMenuOverlay}
        <ScrollToTopButton containerRef={virtuosoScrollerRef as React.RefObject<HTMLElement>} />
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
      <div ref={listContainerRef} className="h-full overflow-y-auto py-1 px-1">
        {groupedContent}
        {contextMenuOverlay}
      </div>

      <ScrollToTopButton containerRef={listContainerRef} />
    </div>
  )
}
