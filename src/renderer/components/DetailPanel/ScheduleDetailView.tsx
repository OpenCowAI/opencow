// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useScheduleCountdown } from '@/hooks/useScheduleCountdown'
import {
  Pencil, Play, Pause, Trash2, Zap, Loader2,
  Clock, CalendarClock, Bolt, Bell, GitBranch, Repeat2,
  ChevronRight, Calendar,
} from 'lucide-react'
import { createLogger } from '@/lib/logger'
import { Tooltip } from '@/components/ui/Tooltip'
import { ScheduleFormModal } from '../ScheduleView/ScheduleFormModal'
import { ExecutionDetailModal } from './ExecutionDetailModal'
import { cn } from '@/lib/utils'
import {
  ACTION_OPTIONS,
  EVENT_TRIGGER_OPTIONS,
} from '../ScheduleView/ScheduleFormModal/constants'
import type { Schedule, ScheduleExecution } from '@shared/types'

const log = createLogger('ScheduleDetailView')

const EMPTY_EXECUTIONS: ScheduleExecution[] = []

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('detail.justNow')
  if (diff < 3_600_000) return t('detail.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('detail.hoursAgo', { count: Math.floor(diff / 3_600_000) })
  const date = new Date(ts)
  const now = new Date()
  const isThisYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString([], {
    month: 'short', day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
  })
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// ─── Status palette ───────────────────────────────────────────────────────────

const SCHEDULE_STATUS_STYLE = {
  active:   { dot: 'bg-green-500',                   badge: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  paused:   { dot: 'bg-yellow-500',                  badge: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  error:    { dot: 'bg-red-500',                     badge: 'bg-red-500/10 text-red-500' },
  completed:{ dot: 'bg-[hsl(var(--muted-foreground))]', badge: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
} as const

const EXEC_STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  success:   { dot: 'bg-green-500',                        label: 'text-green-600 dark:text-green-400' },
  failed:    { dot: 'bg-red-500',                          label: 'text-red-500' },
  running:   { dot: 'bg-blue-500 animate-pulse',           label: 'text-blue-500' },
  timeout:   { dot: 'bg-orange-500',                       label: 'text-orange-500' },
  skipped:   { dot: 'bg-[hsl(var(--muted-foreground)/0.4)]', label: 'text-[hsl(var(--muted-foreground))]' },
  cancelled: { dot: 'bg-[hsl(var(--muted-foreground)/0.4)]', label: 'text-[hsl(var(--muted-foreground))]' },
}

// ─── Stats computation ────────────────────────────────────────────────────────

interface Stats {
  successRate: number | null   // 0–100, null if no terminal executions
  avgDurationMs: number | null
}

function computeStats(executions: ScheduleExecution[]): Stats {
  const terminal = executions.filter(
    (e) => e.status === 'success' || e.status === 'failed' || e.status === 'timeout'
  )
  const successRate = terminal.length > 0
    ? Math.round((terminal.filter((e) => e.status === 'success').length / terminal.length) * 100)
    : null

  const withDuration = executions.filter((e) => e.durationMs != null && e.durationMs > 0)
  const avgDurationMs = withDuration.length > 0
    ? withDuration.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / withDuration.length
    : null

  return { successRate, avgDurationMs }
}

// ─── Trigger summary ──────────────────────────────────────────────────────────

function TriggerSummary({ schedule, t }: { schedule: Schedule; t: (k: string, o?: Record<string, unknown>) => string }): React.JSX.Element {
  const freq = schedule.trigger.time
  const event = schedule.trigger.event

  if (event) {
    const opt = EVENT_TRIGGER_OPTIONS.find((o) => o.value === event.matcherType)
    return (
      <div className="flex items-center gap-2">
        <Bolt className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-sm">{opt ? t(opt.labelKey) : event.matcherType}</span>
      </div>
    )
  }

  if (freq) {
    let summary = t(`frequencyType.${freq.type}`)
    const isOnce = freq.type === 'once'

    if (isOnce && (freq.executeAt || schedule.nextRunAt)) {
      const ts = freq.executeAt ?? schedule.nextRunAt!
      const date = new Date(ts)
      const now = new Date()
      const isThisYear = date.getFullYear() === now.getFullYear()
      const dateStr = date.toLocaleDateString([], {
        month: 'short', day: 'numeric',
        ...(isThisYear ? {} : { year: 'numeric' }),
      })
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      summary = `${dateStr} ${timeStr}`
    } else if (freq.type === 'interval' && freq.intervalMinutes) {
      const mins = freq.intervalMinutes
      if (mins >= 1440) summary = t('trigger.intervalHint.everyNDays', { count: Math.round(mins / 1440) })
      else if (mins >= 60) summary = mins === 60 ? t('trigger.intervalHint.everyHour') : t('trigger.intervalHint.everyNHours', { count: Math.round(mins / 60) })
      else summary = t('trigger.intervalHint.everyNMinutes', { count: mins })
    } else if ((freq.type === 'daily' || freq.type === 'weekly') && freq.timeOfDay) {
      summary += `  ${freq.timeOfDay}`
    }

    const Icon = isOnce ? Calendar : Repeat2
    return (
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-sm">{summary}</span>
        {isOnce && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.5)]">
            {t('frequencyType.once')}
          </span>
        )}
      </div>
    )
  }

  return <></>
}

// ─── Action icon ─────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  start_session:  CalendarClock,
  resume_session: Repeat2,
  create_issue:   GitBranch,
  notification:   Bell,
  webhook:        Bolt,
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-2.5 rounded-xl bg-[hsl(var(--muted)/0.5)]">
      <span className="text-base font-semibold tabular-nums leading-none">{value}</span>
      <span className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 leading-none">{label}</span>
    </div>
  )
}

// ─── ExecutionRow ────────────────────────────────────────────────────────────

function ExecutionRow({
  execution,
  onClick,
}: {
  execution: ScheduleExecution
  onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const style = EXEC_STATUS_STYLE[execution.status] ?? EXEC_STATUS_STYLE.skipped

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[hsl(var(--muted)/0.5)] transition-colors text-left"
    >
      {/* Status dot */}
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', style.dot)} />

      {/* Trigger type */}
      <span className="flex-1 text-xs text-[hsl(var(--foreground)/0.85)] truncate">
        {t(`triggerType.${execution.triggerType}`, { defaultValue: execution.triggerType })}
      </span>

      {/* Duration */}
      <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))] shrink-0 w-10 text-right">
        {formatDuration(execution.durationMs)}
      </span>

      {/* Time */}
      <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))] shrink-0 w-20 text-right">
        {formatRelativeTime(execution.startedAt, t)}
      </span>

      {/* Chevron — visible on hover */}
      <ChevronRight className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground)/0.4)] opacity-0 group-hover:opacity-100 transition-opacity -mr-0.5" aria-hidden="true" />
    </button>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground)/0.6)] mb-2 px-1">
      {children}
    </p>
  )
}

// ─── ScheduleDetailView ──────────────────────────────────────────────────────

export function ScheduleDetailView({ scheduleId }: { scheduleId: string }): React.JSX.Element {
  const { t } = useTranslation('schedule')

  const schedule = useScheduleStore((s) => s.schedules.find((sc) => sc.id === scheduleId))
  const executions = useScheduleStore((s) => s.scheduleExecutions[scheduleId] ?? EMPTY_EXECUTIONS)
  const projects = useAppStore((s) => s.projects)

  const [executionError, setExecutionError] = useState<string | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedExecution, setSelectedExecution] = useState<ScheduleExecution | null>(null)
  const [isTriggering, setIsTriggering] = useState(false)

  const countdown = useScheduleCountdown(schedule?.nextRunAt ?? null)

  // Initial load
  useEffect(() => {
    setExecutionError(null)
    useScheduleStore.getState().loadExecutions(scheduleId).catch((err: unknown) => {
      log.error('loadExecutions failed', err)
      setExecutionError(err instanceof Error ? err.message : 'Failed to load')
    })
  }, [scheduleId])

  // Fallback polling: as long as any execution is still in "running" status, re-fetch from DB every 5s
  // Covers all edge cases: stale state after app crash, missed real-time events, outdated cache, etc.
  const hasRunning = executions.some((e) => e.status === 'running')
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => {
      useScheduleStore.getState().loadExecutions(scheduleId).catch(() => {/* silent */})
    }, 5_000)
    return () => clearInterval(timer)
  }, [scheduleId, hasRunning])

  const handleTriggerNow = async (): Promise<void> => {
    setIsTriggering(true)
    setExecutionError(null)
    try {
      await useScheduleStore.getState().triggerNow(scheduleId)
      await useScheduleStore.getState().loadExecutions(scheduleId)
    } catch (err) {
      log.error('triggerNow failed', err)
      setExecutionError(err instanceof Error ? err.message : 'Failed to trigger')
    } finally {
      setIsTriggering(false)
    }
  }

  const stats = useMemo(() => computeStats(executions), [executions])

  if (!schedule) {
    return (
      <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
        {t('detail.notFound')}
      </div>
    )
  }

  const statusStyle = SCHEDULE_STATUS_STYLE[schedule.status] ?? SCHEDULE_STATUS_STYLE.completed
  const actionOption = ACTION_OPTIONS.find((o) => o.value === schedule.action.type)
  const actionLabel = actionOption ? t(actionOption.labelKey) : schedule.action.type
  const ActionIcon = ACTION_ICONS[schedule.action.type] ?? CalendarClock
  const projectName = schedule.action.projectId
    ? (projects.find((p) => p.id === schedule.action.projectId)?.name ?? null)
    : null

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="px-5 pt-5 pb-4 shrink-0">

        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold leading-tight flex-1 min-w-0 truncate">
            {schedule.name}
          </h2>

          {/* Action toolbar */}
          <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
            <Tooltip content={t('actions.edit')} position="bottom">
              <button
                type="button"
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                onClick={() => setShowEditModal(true)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip content={t('actions.runNow')} position="bottom">
              <button
                type="button"
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handleTriggerNow}
                disabled={isTriggering}
              >
                {isTriggering
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Zap className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </Tooltip>

            {schedule.status === 'active' ? (
              <Tooltip content={t('actions.pause')} position="bottom">
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                  onClick={() => useScheduleStore.getState().pauseSchedule(schedule.id)}
                >
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={t('actions.resume')} position="bottom">
                <button
                  type="button"
                  className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
                  onClick={() => useScheduleStore.getState().resumeSchedule(schedule.id)}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            )}

            <Tooltip content={t('actions.delete')} position="bottom" align="end">
              <button
                type="button"
                className="p-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-500/8 transition-colors"
                onClick={async () => {
                  await useScheduleStore.getState().deleteSchedule(schedule.id)
                  useAppStore.getState().closeDetail()
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Description */}
        {schedule.description && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed mb-3 line-clamp-2">
            {schedule.description}
          </p>
        )}

        {/* Status + countdown */}
        <div className="flex items-center gap-2">
          <span className={cn('flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full', statusStyle.badge)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', statusStyle.dot, schedule.status === 'active' && 'animate-pulse')} />
            {t(`status.${schedule.status}`)}
          </span>
          {schedule.status === 'active' && countdown && (
            <span className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {countdown}
            </span>
          )}
          {schedule.lastRunStatus && (
            <span className={cn(
              'ml-auto text-xs',
              schedule.lastRunStatus === 'success' ? 'text-green-500' : 'text-[hsl(var(--muted-foreground))]'
            )}>
              {schedule.lastRunAt ? formatRelativeTime(schedule.lastRunAt, t) : null}
            </span>
          )}
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5">

        {/* Stats strip */}
        {schedule.executionCount > 0 && (
          <div className="flex gap-2">
            <StatCard
              value={schedule.executionCount.toLocaleString()}
              label={t('detail.statRuns')}
            />
            {stats.successRate !== null && (
              <StatCard
                value={`${stats.successRate}%`}
                label={t('detail.statSuccessRate')}
              />
            )}
            {stats.avgDurationMs !== null && (
              <StatCard
                value={formatDuration(stats.avgDurationMs)}
                label={t('detail.statAvgDuration')}
              />
            )}
          </div>
        )}

        {/* Trigger + Action */}
        <div className="rounded-xl bg-[hsl(var(--muted)/0.35)] divide-y divide-[hsl(var(--border)/0.5)] overflow-hidden">

          {/* Trigger */}
          <div className="px-3.5 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground)/0.6)] mb-1">
                {t('detail.sectionTrigger')}
              </p>
              <TriggerSummary schedule={schedule} t={t} />
            </div>
          </div>

          {/* Action */}
          <div className="px-3.5 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground)/0.6)] mb-1">
                {t('detail.sectionAction')}
              </p>
              <div className="flex items-center gap-2">
                <ActionIcon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
                <span className="text-sm">{actionLabel}</span>
                {projectName && (
                  <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                    · {projectName}
                  </span>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Execution history */}
        <div>
          <SectionLabel>{t('detail.recentExecutions')}</SectionLabel>

          {executionError ? (
            <p className="text-xs text-red-500 px-1">{executionError}</p>
          ) : executions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-[hsl(var(--muted-foreground))]">
              <CalendarClock className="h-6 w-6 mb-2 opacity-30" aria-hidden="true" />
              <p className="text-xs">{t('detail.noExecutions')}</p>
            </div>
          ) : (
            <div className="-mx-1">
              {executions.slice(0, 20).map((exec) => (
                <ExecutionRow
                  key={exec.id}
                  execution={exec}
                  onClick={() => setSelectedExecution(exec)}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Modals */}
      {showEditModal && (
        <ScheduleFormModal editSchedule={schedule} onClose={() => setShowEditModal(false)} />
      )}
      {selectedExecution && (
        <ExecutionDetailModal
          execution={selectedExecution}
          onClose={() => setSelectedExecution(null)}
        />
      )}
    </div>
  )
}
