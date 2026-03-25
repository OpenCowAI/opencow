// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { ListChecks, CheckCircle2 } from 'lucide-react'
import { ISSUE_STATUS_RING_ORDER, ISSUE_STATUS_THEME } from '@/constants/issueStatus'
import type { DashboardStats } from '@/selectors/dashboardSelectors'
import type { IssueStatus } from '@shared/types'

interface StatsCardsProps {
  stats: DashboardStats
}

const ISSUE_STATUS_I18N_KEY: Record<IssueStatus, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'inProgress',
  done: 'done',
  cancelled: 'cancelled'
}

export function StatsCards({ stats }: StatsCardsProps): React.JSX.Element {
  const { t } = useTranslation('dashboard')
  const { t: tIssues } = useTranslation('issues')
  const issueStatusItems = ISSUE_STATUS_RING_ORDER
    .map((status) => ({ status, count: stats.issueStatusCounts[status] }))
    .filter((item) => item.count > 0)

  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2"
      role="region"
      aria-label={t('stats.aria')}
    >
      <div className="flex items-center gap-3">
        <ListChecks
          className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
          aria-hidden="true"
        />
        <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
          {t('stats.totalTasks')}
        </span>
        <span className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
          {stats.totalTasks}
        </span>
      </div>

      <div className="h-4 w-px bg-[hsl(var(--border))]" aria-hidden="true" />

      <div className="flex items-center gap-3">
        <CheckCircle2
          className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]"
          aria-hidden="true"
        />
        <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
          {t('stats.completion')}
        </span>
        <span className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
          {`${Math.round(stats.issueCompletionRate * 100)}%`}
        </span>
        {issueStatusItems.length > 0 && (
          <div className="flex items-center gap-2" aria-label={t('stats.issueStatusBreakdown')}>
            {issueStatusItems.map(({ status, count }) => (
              <span
                key={status}
                className="flex items-center gap-1 text-xs tabular-nums text-[hsl(var(--muted-foreground))]"
                title={`${tIssues(`detail.statusOptions.${ISSUE_STATUS_I18N_KEY[status]}`)}: ${count}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${ISSUE_STATUS_THEME[status].dotColor}`} />
                <span>{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
