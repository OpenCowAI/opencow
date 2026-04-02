// SPDX-License-Identifier: Apache-2.0

import type {
  Session,
  StatsSnapshot,
  Project,
  TaskFull,
  SessionSnapshot,
  IssueSummary,
  IssueStatus
} from '@shared/types'
import type { SessionStatusCounts } from '@/hooks/useSessionStatusCounts'

// === Return types ===

export interface DashboardStats {
  totalSessions: number
  sessionStatusCounts: SessionStatusCounts
  /**
   * Backward-compatible task metrics retained for selectors/tests and
   * potential downstream consumers. Dashboard UI now primarily surfaces
   * issue-centric metrics.
   */
  totalTasks: number
  taskCompletionRate: number
  totalIssues: number
  issueStatusCounts: Record<IssueStatus, number>
  issueCompletionRate: number
  todayTokens: number
  todayCost: number
}

export interface ActivityDatum {
  day: string // 'YYYY-MM-DD'
  value: number // session count
}

export interface ProjectRankingItem {
  projectId: string
  projectName: string
  sessionCount: number
}

export interface RecentActivityItem {
  sessionId: string
  sessionName: string
  projectId: string
  projectName: string
  status: Session['status']
  lastActivity: number
}

// === Selector params ===

interface StatsParams {
  sessions: Session[]
  issues: IssueSummary[]
  stats: StatsSnapshot | null
  tasksByList?: Record<string, TaskFull[]>
  selectedProjectId: string | null
}

interface ActivityParams {
  managedSessions: SessionSnapshot[]
  selectedProjectId: string | null
}

interface RankingParams {
  sessions: Session[]
  projects: Project[]
}

interface RecentParams {
  sessions: Session[]
  projects: Project[]
  selectedProjectId: string | null
}

// === Helpers ===

function filterByProject(sessions: Session[], projectId: string | null): Session[] {
  if (!projectId) return sessions
  return sessions.filter((s) => s.projectId === projectId)
}

function filterIssuesByProject(issues: IssueSummary[], projectId: string | null): IssueSummary[] {
  if (!projectId) return issues
  return issues.filter((i) => i.projectId === projectId)
}

function filterManagedByProject(
  managedSessions: SessionSnapshot[],
  projectId: string | null
): SessionSnapshot[] {
  if (!projectId) return managedSessions
  return managedSessions.filter((s) => s.projectId === projectId)
}

// === Selectors ===

export function selectDashboardStats(params: StatsParams): DashboardStats {
  const { stats, selectedProjectId } = params
  const sessions = filterByProject(params.sessions, selectedProjectId)
  const issues = filterIssuesByProject(params.issues, selectedProjectId)
  const allTasks = Object.values(params.tasksByList ?? {}).flat()
  const totalTasks = allTasks.length
  const completedTasks = allTasks.filter((task) => task.status === 'completed').length

  const sessionStatusCounts: SessionStatusCounts = { active: 0, waiting: 0, completed: 0, error: 0 }
  for (const s of sessions) sessionStatusCounts[s.status]++
  const issueStatusCounts: Record<IssueStatus, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    done: 0,
    cancelled: 0
  }
  for (const issue of issues) issueStatusCounts[issue.status]++

  const totalIssues = issues.length
  const issueCompletionRate = totalIssues > 0 ? issueStatusCounts.done / totalIssues : 0

  return {
    totalSessions: sessions.length,
    sessionStatusCounts,
    totalTasks,
    taskCompletionRate: totalTasks > 0 ? completedTasks / totalTasks : 0,
    totalIssues,
    issueStatusCounts,
    issueCompletionRate,
    todayTokens: stats?.todayTokens ?? 0,
    todayCost: stats?.todayCostUSD ?? 0
  }
}

export function selectActivityData(params: ActivityParams): ActivityDatum[] {
  const { selectedProjectId } = params
  const managedSessions = filterManagedByProject(params.managedSessions, selectedProjectId)

  if (managedSessions.length === 0) return []

  const countByDay = new Map<string, number>()
  for (const session of managedSessions) {
    const day = new Date(session.createdAt).toISOString().slice(0, 10)
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1)
  }

  return Array.from(countByDay.entries()).map(([day, value]) => ({ day, value }))
}

export function selectProjectRanking(params: RankingParams): ProjectRankingItem[] {
  const { sessions, projects } = params

  const countByProject = new Map<string, number>()
  for (const session of sessions) {
    countByProject.set(session.projectId, (countByProject.get(session.projectId) ?? 0) + 1)
  }

  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  return Array.from(countByProject.entries())
    .map(([projectId, sessionCount]) => ({
      projectId,
      projectName: projectMap.get(projectId) ?? projectId,
      sessionCount
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount)
    .slice(0, 5)
}

export function selectRecentActivity(params: RecentParams): RecentActivityItem[] {
  const { projects, selectedProjectId } = params
  const sessions = filterByProject(params.sessions, selectedProjectId)

  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  return [...sessions]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, 10)
    .map((s) => ({
      sessionId: s.id,
      sessionName: s.name,
      projectId: s.projectId,
      projectName: projectMap.get(s.projectId) ?? s.projectId,
      status: s.status,
      lastActivity: s.lastActivity
    }))
}
