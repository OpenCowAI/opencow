// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { TrayIssueItem, TraySessionStatus, IssuePriority } from '@shared/types'

interface TrayPopoverIssueListProps {
  items: TrayIssueItem[]
  onNavigateIssue: (issueId: string, projectId: string) => void
}

// ── Status grouping (single-pass) ───────────────────────────────────────

/** Group configuration keyed by TraySessionStatus for stable React keys. */
interface GroupConfig {
  key: TraySessionStatus
  labelKey: 'tray.needsAttention' | 'tray.errors' | 'tray.active'
  dotClass: string
  /** Display order — lower values appear first. */
  order: number
}

const GROUP_CONFIGS: Record<TraySessionStatus, GroupConfig> = {
  waiting: { key: 'waiting', labelKey: 'tray.needsAttention', dotClass: 'bg-amber-500', order: 0 },
  error:   { key: 'error',   labelKey: 'tray.errors',         dotClass: 'bg-destructive', order: 1 },
  active:  { key: 'active',  labelKey: 'tray.active',         dotClass: 'bg-emerald-500', order: 2 },
}

interface IssueGroup {
  config: GroupConfig
  label: string
  items: TrayIssueItem[]
}

/** Single-pass grouping: partitions items by sessionStatus and returns counts. */
function groupItems(
  items: TrayIssueItem[],
  t: TFunction<'navigation'>,
): { groups: IssueGroup[]; activeCount: number; waitingCount: number } {
  const buckets = new Map<TraySessionStatus, TrayIssueItem[]>()

  for (const item of items) {
    let bucket = buckets.get(item.sessionStatus)
    if (!bucket) {
      bucket = []
      buckets.set(item.sessionStatus, bucket)
    }
    bucket.push(item)
  }

  const groups: IssueGroup[] = []
  for (const [status, bucket] of buckets) {
    const config = GROUP_CONFIGS[status]
    groups.push({ config, label: t(config.labelKey), items: bucket })
  }
  groups.sort((a, b) => a.config.order - b.config.order)

  return {
    groups,
    activeCount: buckets.get('active')?.length ?? 0,
    waitingCount: buckets.get('waiting')?.length ?? 0,
  }
}

// ── Relative time ────────────────────────────────────────────────────────

function relativeTime(timestamp: number, t: TFunction<'common'>): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return t('timeAgo.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('timeAgo.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('timeAgo.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('timeAgo.daysAgo', { count: days })
}

// ── Priority indicator ──────────────────────────────────────────────────

const priorityColors: Record<IssuePriority, string> = {
  urgent: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-blue-500',
  low: 'text-muted-foreground/50',
}

// ── Issue item ──────────────────────────────────────────────────────────

interface IssueItemProps {
  item: TrayIssueItem
  dotClass: string
  onClick: () => void
  tCommon: TFunction<'common'>
}

function IssueItem({ item, dotClass, onClick, tCommon }: IssueItemProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="w-[calc(100%-12px)] flex items-start gap-2.5 mx-1.5 px-2 py-2 rounded-lg cursor-pointer
        hover:bg-accent/80 active:bg-accent active:scale-[0.98]
        transition-all duration-150 ease-out text-left group"
    >
      {/* Status dot — brightens on hover */}
      <span
        className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 transition-shadow duration-150
          ${dotClass}
          ${item.sessionStatus === 'active' ? 'animate-[pulse-breathe_2s_ease-in-out_infinite]' : ''}
          group-hover:shadow-[0_0_6px_1px_currentColor]`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Primary line: priority dot + issue title */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`w-1 h-1 rounded-full shrink-0 ${priorityColors[item.issuePriority]}`} style={{ backgroundColor: 'currentColor' }} />
          <span className="text-xs text-foreground/80 group-hover:text-foreground truncate transition-colors duration-150">
            {item.issueTitle}
          </span>
        </div>

        {/* Secondary line: project + time */}
        <div className="flex items-center gap-1 mt-0.5">
          {item.projectName && (
            <>
              <span className="text-[10px] text-muted-foreground group-hover:text-muted-foreground/80 truncate max-w-[120px] transition-colors duration-150">
                {item.projectName}
              </span>
              <span className="text-[10px] text-muted-foreground/50">·</span>
            </>
          )}
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {relativeTime(item.lastActivity, tCommon)}
          </span>
        </div>
      </div>

      {/* Hover arrow — slides in from left */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-1 shrink-0 opacity-0 -translate-x-1
          group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-muted-foreground
          transition-all duration-150"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────────────────

export function TrayPopoverIssueList({
  items,
  onNavigateIssue,
}: TrayPopoverIssueListProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const { t: tCommon } = useTranslation('common')
  const { groups, activeCount, waitingCount } = groupItems(items, t)

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-8">
        <p className="text-xs text-muted-foreground">{t('tray.noActiveIssues')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats pills */}
      <div className="flex items-center gap-2 px-3.5 py-2">
        {activeCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-[pulse-breathe_2s_ease-in-out_infinite]" />
            {activeCount} {t('tray.active')}
          </span>
        )}
        {waitingCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {waitingCount} {t('tray.waiting')}
          </span>
        )}
      </div>

      {/* Grouped issues — keyed by stable status string, not translated label */}
      {groups.map((group) => (
        <div key={group.config.key}>
          {/* Section header */}
          <div className="px-3.5 pt-2 pb-1">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label} ({group.items.length})
            </span>
          </div>

          {/* Issue items — show up to 5 per group */}
          {group.items.slice(0, 5).map((item) => (
            <IssueItem
              key={item.managedSessionId}
              item={item}
              dotClass={group.config.dotClass}
              onClick={() => onNavigateIssue(item.issueId, item.projectId)}
              tCommon={tCommon}
            />
          ))}

          {group.items.length > 5 && (
            <div className="px-3.5 py-1">
              <span className="text-[10px] text-muted-foreground">
                {t('tray.more', { count: group.items.length - 5 })}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
