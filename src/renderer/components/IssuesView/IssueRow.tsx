// SPDX-License-Identifier: Apache-2.0

import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ExternalLink, StickyNote } from 'lucide-react'
import { cn } from '../../lib/utils'
import { ISSUE_STATUS_THEME, ISSUE_STATUS_RING_ORDER } from '../../constants/issueStatus'
import { IssueStatusIcon, IssuePriorityIcon } from './IssueIcons'
import { SegmentedRing } from '../ui/SegmentedRing'
import type { RingSegment } from '../ui/SegmentedRing'
import { SessionActivityDot } from '../ui/SessionActivityDot'
import { Tooltip } from '../ui/Tooltip'
import { useIssueSessionContext } from '../../stores/commandStore'
import { useNoteStore } from '../../stores/noteStore'
import type { ChildStatusCounts, IssueRowProps } from './types'

/** Map domain-specific ChildStatusCounts to generic RingSegment[] for SegmentedRing. */
function buildRingSegments(counts: ChildStatusCounts): RingSegment[] {
  const segments: RingSegment[] = []
  for (const status of ISSUE_STATUS_RING_ORDER) {
    const value = counts[status]
    if (value > 0) {
      const theme = ISSUE_STATUS_THEME[status]
      segments.push({ value, color: theme.ringColor, label: theme.label })
    }
  }
  return segments
}

// ---------------------------------------------------------------------------
// Self-subscribing sub-components — each row subscribes to its own data via
// narrow Zustand selectors.  Only the specific row whose data changed will
// re-render, instead of re-rendering the entire list.
// ---------------------------------------------------------------------------

/**
 * Session activity indicator that self-subscribes to the store.
 * Only re-renders when THIS session's state or timing changes.
 *
 * `useIssueSessionContext` returns flat primitives (not a nested
 * `ActiveDuration` object) so that Zustand's `shallow` equality works
 * correctly.  We reconstruct the `ActiveDuration` here for `SessionActivityDot`.
 */
const IssueSessionIndicator = memo(function IssueSessionIndicator({
  sessionId,
}: {
  sessionId: string | null
}): React.JSX.Element | null {
  const ctx = useIssueSessionContext(sessionId)

  // useMemo MUST be called unconditionally — Rules of Hooks forbid hooks
  // after conditional returns.  Returns `undefined` when ctx is null;
  // the early return below handles that case.
  const activeDuration = useMemo(
    () => ctx
      ? { accumulatedMs: ctx.activeDurationMs, activeStartedAt: ctx.activeStartedAt }
      : undefined,
    [ctx?.activeDurationMs, ctx?.activeStartedAt],
  )

  if (!ctx) return null
  return <SessionActivityDot state={ctx.state} activeDuration={activeDuration} />
})

/**
 * Note count badge that self-subscribes to the store.
 * Only re-renders when THIS issue's note count changes.
 */
const IssueNoteCountBadge = memo(function IssueNoteCountBadge({
  issueId,
}: {
  issueId: string
}): React.JSX.Element | null {
  const { t } = useTranslation('issues')
  const noteCount = useNoteStore((s) => s.noteCountsByIssue[issueId] ?? 0)
  if (noteCount <= 0) return null
  return (
    <Tooltip content={t('noteCount', { count: noteCount })} position="top">
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] shrink-0">
        <StickyNote className="w-2.5 h-2.5" />
        <span className="text-[10px] font-medium tabular-nums leading-none">{noteCount}</span>
      </span>
    </Tooltip>
  )
})

/**
 * Pure presentation component for a single issue row.
 * Knows nothing about DnD — all DnD visual state is passed via the optional dndState prop.
 *
 * Session state and note counts are handled by self-subscribing sub-components
 * (`IssueSessionIndicator`, `IssueNoteCountBadge`) so that changes to a single
 * session or note count only re-render the affected row, not the entire list.
 */
export const IssueRow = memo(function IssueRow({
  issue,
  selection,
  hierarchy,
  context,
  dndState
}: IssueRowProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { isSelected, onSelect, onContextMenu, onPrefetch } = selection
  const { isChild, childCount, childStatusCounts, isCollapsed, onToggleCollapse } = hierarchy
  const { projectName, isUnread } = context

  const ringSegments = useMemo(
    () => (childStatusCounts ? buildRingSegments(childStatusCounts) : null),
    [childStatusCounts]
  )

  return (
    <button
      onClick={(e) => onSelect(e)}
      onMouseEnter={onPrefetch}
      onContextMenu={onContextMenu}
      className={cn(
        'w-full flex items-center gap-3 py-2 text-left rounded-lg transition-[background-color] duration-[45ms]',
        isChild ? 'pl-8 pr-3' : 'px-3',
        isSelected
          ? 'bg-[hsl(var(--primary)/0.07)]'
          : 'hover:bg-[hsl(var(--foreground)/0.03)]',
        // DnD visual feedback
        dndState?.isDragging && 'opacity-40',
        dndState?.isDropTarget && dndState.isValidDrop &&
          'ring-2 ring-[hsl(var(--primary))] ring-inset bg-[hsl(var(--primary)/0.07)] rounded-lg',
        dndState?.isDropTarget && !dndState.isValidDrop &&
          'ring-2 ring-red-400/50 ring-inset bg-red-400/5 rounded-lg'
      )}
      aria-label={t('issueAria', { title: issue.title })}
      aria-pressed={isSelected}
    >
      {/* Collapse toggle for parent issues with children */}
      {childCount > 0 ? (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse()
          }}
          className="p-0.5 -ml-1 rounded hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
          aria-label={isCollapsed ? t('expandSubIssues') : t('collapseSubIssues')}
        >
          <ChevronRight
            className={cn(
              'w-3 h-3 text-[hsl(var(--muted-foreground))] transition-transform',
              !isCollapsed && 'rotate-90'
            )}
          />
        </span>
      ) : isChild ? (
        <span className="w-3 text-[hsl(var(--muted-foreground))] text-[10px] text-center shrink-0" aria-hidden="true">
          └
        </span>
      ) : null}

      {/* Status icon */}
      <IssueStatusIcon status={issue.status} />

      {/* Unread indicator */}
      {isUnread && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] shrink-0"
          aria-label={t('unread')}
        />
      )}

      {/* Title + Notes badge */}
      <span className="flex-1 flex items-center gap-1.5 min-w-0">
        <span className={cn(
          'text-sm truncate',
          isUnread
            ? 'font-semibold text-[hsl(var(--foreground))]'
            : 'text-[hsl(var(--foreground))]'
        )}>
          {issue.title}
        </span>
        <IssueNoteCountBadge issueId={issue.id} />
      </span>

      {/* Sub-issue status ring */}
      {childCount > 0 && ringSegments && (
        <SegmentedRing segments={ringSegments}>
          <span className="text-[8px] font-medium tabular-nums text-[hsl(var(--muted-foreground))]">
            {childCount}
          </span>
        </SegmentedRing>
      )}

      {/* Labels */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {issue.labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="px-1.5 py-0.5 text-[10px] rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground))]"
          >
            {label}
          </span>
        ))}
        {issue.labels.length > 2 && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            +{issue.labels.length - 2}
          </span>
        )}
      </div>

      {/* Remote source badge */}
      {issue.remoteNumber != null && (
        <span
          role="link"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            if (issue.remoteUrl && /^https?:\/\//i.test(issue.remoteUrl)) window.open(issue.remoteUrl, '_blank')
          }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted)/0.6)] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors cursor-pointer shrink-0"
          title={issue.remoteUrl ?? undefined}
        >
          <ExternalLink className="w-2.5 h-2.5" />
          <span className="text-[10px] font-medium leading-none">#{issue.remoteNumber}</span>
        </span>
      )}

      {/* Priority */}
      <IssuePriorityIcon priority={issue.priority} />

      {/* Session activity indicator — self-subscribing */}
      <IssueSessionIndicator sessionId={issue.sessionId ?? null} />

      {/* Project name */}
      {projectName && (
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate max-w-[80px]">
          {projectName}
        </span>
      )}
    </button>
  )
})
