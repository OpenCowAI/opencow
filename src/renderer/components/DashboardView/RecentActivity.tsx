// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ISSUE_STATUS_THEME } from '@/constants/issueStatus'
import { IssueStatusIcon } from '@/components/IssuesView/IssueIcons'
import { formatRelativeTime } from '@shared/inboxFormatters'
import type { IssueSummary } from '@shared/types'

interface RecentIssuesProps {
  items: IssueSummary[]
  onSelectIssue: (issueId: string) => void
}

export function RecentIssues({ items, onSelectIssue }: RecentIssuesProps): React.JSX.Element {
  const { t } = useTranslation('dashboard')
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">{t('recentIssues.title')}</h3>
        <div className="flex items-center justify-center h-20 text-sm text-[hsl(var(--muted-foreground))]">
          {t('recentIssues.noData')}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <h3 className="text-sm font-medium text-[hsl(var(--foreground))] mb-3">{t('recentIssues.title')}</h3>
      <ul className="space-y-1" aria-label={t('recentIssues.aria')}>
        {items.map((item) => {
          const theme = ISSUE_STATUS_THEME[item.status]
          return (
            <li key={item.id}>
              <button
                onClick={() => onSelectIssue(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left text-sm',
                  'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors'
                )}
                aria-label={`${item.title} - ${theme.label}`}
              >
                <span className="text-xs text-[hsl(var(--muted-foreground))] w-14 shrink-0 tabular-nums">
                  {formatRelativeTime(item.updatedAt)}
                </span>
                <IssueStatusIcon status={item.status} className="shrink-0" />
                <span className="truncate flex-1 text-[hsl(var(--foreground))]">
                  {item.title}
                </span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{theme.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
