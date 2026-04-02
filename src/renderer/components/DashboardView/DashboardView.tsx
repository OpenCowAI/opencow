// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useIssueStore, selectIssuesArray } from '@/stores/issueStore'
import { selectIssue } from '@/actions/issueActions'
import { useCommandStore } from '@/stores/commandStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTasksStore } from '@/stores/tasksStore'
import {
  selectDashboardStats,
  selectActivityData,
  selectProjectRanking
} from '@/selectors/dashboardSelectors'
import type { ActivityDatum } from '@/selectors/dashboardSelectors'
import { ProjectSettingsModal } from '@/components/ProjectSettings/ProjectSettingsModal'
import { StatsCards } from './StatsCards'
import { ActivityHeatmap } from './ActivityHeatmap'
import { ProjectRanking } from './ProjectRanking'
import { RecentIssues } from './RecentActivity'

/**
 * Structural equality for activity heatmap data — only re-renders when
 * the day/count distribution actually changes.
 *
 * `selectActivityData` groups sessions by `createdAt` date.  During
 * streaming, `createdAt` is immutable, so the heatmap result is stable.
 * This comparator ensures the component skips re-render on every
 * metadata flush (cost, tokens, context) even though the
 * `managedSessions` array reference changes.
 */
function activityDataEqual(a: ActivityDatum[], b: ActivityDatum[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].day !== b[i].day || a[i].value !== b[i].value) return false
  }
  return true
}

export function DashboardView(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const projectSettingsLabel = t('projectActions.settings')
  const sessions = useAppStore((s) => s.sessions)
  const projects = useAppStore((s) => s.projects)
  const stats = useStatsStore((s) => s.stats)
  const tasksByList = useTasksStore((s) => s.tasksByList)
  const selectedProjectId = useAppStore(selectProjectId)
  const issues = useIssueStore(selectIssuesArray)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)

  const dashboardStats = useMemo(
    () => selectDashboardStats({ sessions, issues, stats, tasksByList, selectedProjectId }),
    [sessions, issues, stats, tasksByList, selectedProjectId]
  )

  // Activity heatmap data — computed inside a Zustand selector so that
  // `managedSessions` is never exposed to this component.  The custom
  // `activityDataEqual` comparator ensures zero re-renders during
  // streaming (createdAt is immutable → day counts are stable).
  const activityData = useStoreWithEqualityFn(
    useCommandStore,
    (s) => selectActivityData({ managedSessions: s.managedSessions, selectedProjectId }),
    activityDataEqual,
  )

  const projectRanking = useMemo(
    () => selectProjectRanking({ sessions, projects }),
    [sessions, projects]
  )

  const recentIssues = useMemo(() => {
    const filtered = selectedProjectId
      ? issues.filter((i) => i.projectId === selectedProjectId)
      : issues
    return [...filtered]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
  }, [issues, selectedProjectId])

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <StatsCards
        stats={dashboardStats}
        actions={(
          <>
            {selectedProjectId ? (
              <button
                type="button"
                onClick={() => setSettingsProjectId(selectedProjectId)}
                className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]"
                aria-label={projectSettingsLabel}
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {projectSettingsLabel}
              </button>
            ) : (
              <span
                aria-hidden="true"
                className="invisible inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs"
              >
                <Settings className="h-3.5 w-3.5" />
                {projectSettingsLabel}
              </span>
            )}
          </>
        )}
      />
      <ActivityHeatmap data={activityData} />
      {!selectedProjectId && <ProjectRanking data={projectRanking} />}
      <RecentIssues items={recentIssues} onSelectIssue={selectIssue} />

      {settingsProjectId && (
        <ProjectSettingsModal
          projectId={settingsProjectId}
          onClose={() => setSettingsProjectId(null)}
        />
      )}
    </div>
  )
}
