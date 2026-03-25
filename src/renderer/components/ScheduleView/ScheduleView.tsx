// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Plus, Sparkles, MoreHorizontal } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useScheduleCountdown } from '@/hooks/useScheduleCountdown'
import { formatFrequencySummary } from '@/lib/scheduleFormatters'
import { groupProjects } from '@shared/projectGrouping'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { ScheduleFormModal } from './ScheduleFormModal'
import { ScheduleAICreatorModal } from '../ScheduleAICreator'
import { EVENT_TRIGGER_OPTIONS } from './ScheduleFormModal/constants'
import { cn } from '@/lib/utils'
import type { Schedule } from '@shared/types'

// Frequency formatting is handled by the shared utility: @/lib/scheduleFormatters

// ─── ScheduleListItem ─────────────────────────────────────────────────────────

function ScheduleListItem({
  schedule,
  projectName,
}: {
  schedule: Schedule
  /** When provided, display the owning project name on the card (used in the "all projects" view) */
  projectName?: string
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const countdown = useScheduleCountdown(schedule.nextRunAt)
  const openDetail = useAppStore((s) => s.openDetail)

  const subtitle = schedule.description || formatFrequencySummary(schedule, t, EVENT_TRIGGER_OPTIONS)

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border)/0.5)] hover:border-[hsl(var(--border))] cursor-pointer transition-colors"
      onClick={() => openDetail({ type: 'schedule', scheduleId: schedule.id })}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{schedule.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {subtitle && (
            <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{subtitle}</span>
          )}
          {projectName && (
            <>
              {subtitle && <span className="text-[hsl(var(--muted-foreground)/0.4)] shrink-0">·</span>}
              <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] shrink-0 truncate max-w-[120px]">
                {projectName}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-xs font-medium ${
            schedule.status === 'active'
              ? 'text-green-500'
              : schedule.status === 'paused'
                ? 'text-yellow-500'
                : schedule.status === 'error'
                  ? 'text-red-500'
                  : 'text-[hsl(var(--muted-foreground))]'
          }`}
        >
          {t(`status.${schedule.status}`)}
        </div>
        {schedule.status === 'active' && (
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{countdown}</div>
        )}
      </div>
    </div>
  )
}

// ─── FilterPill ──────────────────────────────────────────────────────────────

const PILL_BASE = 'shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors'
const PILL_ACTIVE = 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))] font-medium'
const PILL_INACTIVE = 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)]'

/** A single pill-shaped toggle button used in the filter bar. */
function FilterPill({
  active,
  truncate,
  className,
  children,
  ...rest
}: {
  active: boolean
  truncate?: boolean
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'>): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        PILL_BASE,
        active ? PILL_ACTIVE : PILL_INACTIVE,
        truncate && 'truncate max-w-[120px]',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

// ─── ProjectFilterBar ─────────────────────────────────────────────────────────

/**
 * Project filter bar — shows active projects as pill buttons directly,
 * and collapses archived projects behind a "More" popover to keep the bar clean.
 */
function ProjectFilterBar({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const projects = useAppStore((s) => s.projects)

  const grouped = useMemo(() => groupProjects(projects), [projects])
  const visibleProjects = useMemo(() => [...grouped.pinned, ...grouped.projects], [grouped])
  const archivedProjects = grouped.archived

  const [moreOpen, setMoreOpen] = useState(false)
  const selectedIsArchived = archivedProjects.some((p) => p.id === selected)

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-[hsl(var(--border)/0.5)] overflow-x-auto no-scrollbar shrink-0">
      <FilterPill active={selected === null} onClick={() => onSelect(null)}>
        {t('filter.allProjects', { defaultValue: 'All' })}
      </FilterPill>

      {visibleProjects.map((p) => (
        <FilterPill key={p.id} active={selected === p.id} truncate onClick={() => onSelect(p.id)}>
          {p.name}
        </FilterPill>
      ))}

      {archivedProjects.length > 0 && (
        <PillDropdown
          open={moreOpen}
          onOpenChange={setMoreOpen}
          position="below"
          trigger={
            <FilterPill
              active={selectedIsArchived}
              className="inline-flex items-center gap-1"
              onClick={() => setMoreOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              title={t('filter.archivedProjects', { defaultValue: 'Archived projects' })}
            >
              <MoreHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              {selectedIsArchived && (
                <span className="truncate max-w-[100px]">
                  {archivedProjects.find((p) => p.id === selected)?.name}
                </span>
              )}
            </FilterPill>
          }
        >
          <div className="max-w-[240px] max-h-[280px] overflow-y-auto" role="menu">
            <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground)/0.6)]">
              {t('filter.archived', { defaultValue: 'Archived' })}
            </div>
            {archivedProjects.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                type="button"
                onClick={() => {
                  onSelect(p.id)
                  setMoreOpen(false)
                }}
                className={cn(
                  'w-full text-left px-2.5 py-1.5 text-xs transition-colors truncate',
                  selected === p.id
                    ? 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))] font-medium'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.05)] hover:text-[hsl(var(--foreground))]'
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </PillDropdown>
      )}
    </div>
  )
}

// ─── ScheduleView ─────────────────────────────────────────────────────────────

export function ScheduleView(): React.JSX.Element {
  const { t } = useTranslation('schedule')

  // Schedule list is global — not dependent on the sidebar's selected project
  const allSchedules = useScheduleStore((s) => s.schedules)
  const allPipelines = useScheduleStore((s) => s.pipelines)
  const projects = useAppStore((s) => s.projects)

  const [showForm, setShowForm] = useState(false)
  const [showAICreator, setShowAICreator] = useState(false)
  // Independent project filter state within the list; null = all
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null)

  // Show the filter bar as long as there are projects in the store (regardless of whether any schedule is bound to a project)
  const showFilterBar = projects.length > 0

  // Filter by local filterProjectId
  const schedules = useMemo(
    () => filterProjectId
      ? allSchedules.filter((s) => s.projectId === filterProjectId)
      : allSchedules,
    [allSchedules, filterProjectId]
  )
  const pipelines = useMemo(
    () => filterProjectId
      ? allPipelines.filter((p) => p.projectId === filterProjectId)
      : allPipelines,
    [allPipelines, filterProjectId]
  )

  // In the "all" view, look up the project name for each schedule to display
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return map
  }, [projects])

  const activeSchedules = schedules.filter((s) => s.status === 'active')
  const pausedSchedules = schedules.filter((s) => s.status === 'paused')

  // In the "all projects" view, when there are multiple projects in the store, annotate each card with its owning project name
  const isAllProjectsView = filterProjectId === null && projects.length > 1

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="drag-region flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          <h1 className="text-sm font-semibold no-drag">{t('title')}</h1>
          {activeSchedules.length > 0 && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {activeSchedules.length} {t('active').toLowerCase()}
            </span>
          )}
        </div>
        <div className="no-drag flex items-center gap-1.5">
          {/* AI Create schedule button */}
          <button
            onClick={() => setShowAICreator(true)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-violet-500 hover:bg-violet-500/10 transition-colors text-xs font-medium"
            aria-label={t('aiCreator.title')}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            <span>AI</span>
          </button>

          {/* Create schedule button */}
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-medium hover:bg-[hsl(var(--primary)/0.9)] transition-colors"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t('newSchedule')}
          </button>
        </div>
      </div>

      {/* Project filter bar — only shown when there are multiple projects in the list */}
      {showFilterBar && (
        <ProjectFilterBar
          selected={filterProjectId}
          onSelect={setFilterProjectId}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {schedules.length === 0 && pipelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[hsl(var(--muted-foreground))]">
            <CalendarClock className="h-12 w-12 mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm font-medium">{t('noSchedules')}</p>
            <p className="text-xs mt-1">{t('noSchedulesHint')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeSchedules.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                  {t('active')} ({activeSchedules.length})
                </h3>
                <div className="space-y-2">
                  {activeSchedules
                    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
                    .map((s) => (
                      <ScheduleListItem
                        key={s.id}
                        schedule={s}
                        projectName={isAllProjectsView && s.projectId
                          ? projectNameById.get(s.projectId)
                          : undefined}
                      />
                    ))}
                </div>
              </section>
            )}

            {pausedSchedules.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                  {t('paused')} ({pausedSchedules.length})
                </h3>
                <div className="space-y-2">
                  {pausedSchedules.map((s) => (
                    <ScheduleListItem
                      key={s.id}
                      schedule={s}
                      projectName={isAllProjectsView && s.projectId
                        ? projectNameById.get(s.projectId)
                        : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {pipelines.length > 0 && (
              <section>
                <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
                  {t('pipelines')} ({pipelines.length})
                </h3>
                <div className="space-y-2">
                  {pipelines.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border)/0.5)] hover:border-[hsl(var(--border))] cursor-pointer transition-colors"
                      onClick={() => {
                        // TODO: Open pipeline detail
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                          {p.steps.length} {t('steps')} &middot; {t(`status.${p.status}`)}
                          {isAllProjectsView && p.projectId && projectNameById.get(p.projectId) && (
                            <> &middot; <span className="opacity-60">{projectNameById.get(p.projectId)}</span></>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {showForm && <ScheduleFormModal onClose={() => setShowForm(false)} />}

      {/* AI Schedule Creator modal */}
      <ScheduleAICreatorModal
        open={showAICreator}
        onClose={() => setShowAICreator(false)}
      />
    </div>
  )
}
