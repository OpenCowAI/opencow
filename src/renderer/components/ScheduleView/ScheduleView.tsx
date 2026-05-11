// SPDX-License-Identifier: Apache-2.0

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalendarClock,
  CalendarDays,
  Plus,
  Repeat,
  SearchX,
  Sparkles,
  MoreHorizontal,
  Terminal,
  Workflow,
  Zap,
  Activity,
  Pause,
} from 'lucide-react'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useScheduleCountdown } from '@/hooks/useScheduleCountdown'
import { formatFrequencySummary } from '@/lib/scheduleFormatters'
import { groupProjects } from '@shared/projectGrouping'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { SchedulePreviewOverlay } from './SchedulePreviewOverlay'
import { ScheduleFormModal } from './ScheduleFormModal'
import { ScheduleAICreatorModal } from '../ScheduleAICreator'
import { EVENT_TRIGGER_OPTIONS } from './ScheduleFormModal/constants'
import { cn } from '@/lib/utils'
import type { Schedule, SchedulePipeline } from '@shared/types'

// Frequency formatting is handled by the shared utility: @/lib/scheduleFormatters

// ─── Scope Model ─────────────────────────────────────────────────────────────

type ScheduleScope =
  | { kind: 'all-projects'; filterProjectId: string | null }
  | { kind: 'project'; projectId: string }

function resolveScheduleScope(
  selectedProjectId: string | null,
  allProjectsFilterProjectId: string | null,
): ScheduleScope {
  if (selectedProjectId) {
    return { kind: 'project', projectId: selectedProjectId }
  }
  return { kind: 'all-projects', filterProjectId: allProjectsFilterProjectId }
}

function effectiveProjectIdFromScope(scope: ScheduleScope): string | null {
  return scope.kind === 'project' ? scope.projectId : scope.filterProjectId
}

// ─── Visual helpers ───────────────────────────────────────────────────────────

/**
 * Pick the icon that best represents the schedule's trigger:
 *   - event-based                              → Zap
 *   - cron                                     → Terminal
 *   - once                                     → CalendarClock
 *   - interval                                 → Repeat
 *   - daily / weekly / biweekly / monthly      → CalendarDays
 * Falls back to CalendarClock when no trigger details are available.
 */
function getScheduleTriggerIcon(schedule: Schedule): React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> {
  if (schedule.trigger.event) return Zap
  const freqType = schedule.trigger.time?.type
  switch (freqType) {
    case 'cron': return Terminal
    case 'once': return CalendarClock
    case 'interval': return Repeat
    case 'daily':
    case 'weekly':
    case 'biweekly':
    case 'monthly':
      return CalendarDays
    default:
      return CalendarClock
  }
}

const STATUS_DOT_CLASS: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  error: 'bg-red-500',
  completed: 'bg-[hsl(var(--muted-foreground)/0.5)]',
}

const STATUS_TEXT_CLASS: Record<string, string> = {
  active: 'text-green-600 dark:text-green-500',
  paused: 'text-yellow-600 dark:text-yellow-500',
  error: 'text-red-600 dark:text-red-500',
  completed: 'text-[hsl(var(--muted-foreground))]',
}

// ─── Shared row chrome ───────────────────────────────────────────────────────

/**
 * Base styles for both Schedule rows and Pipeline rows so they share
 * identical chrome (icon panel, two-line content, optional right meta).
 */
const ROW_BASE = cn(
  'group/sched-row flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer',
  'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
)

/** Grayscale wash applied to the currently-selected row. */
const ROW_SELECTED = 'bg-[hsl(var(--foreground)/0.08)] hover:bg-[hsl(var(--foreground)/0.08)]'

function RowIcon({
  Icon,
  tone = 'default',
}: {
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  tone?: 'default' | 'pipeline'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg',
        'border border-[hsl(var(--border)/0.6)] bg-[hsl(var(--muted)/0.4)]',
        'text-[hsl(var(--muted-foreground))]',
        'transition-colors group-hover/sched-row:text-[hsl(var(--foreground))]',
        tone === 'pipeline' && 'text-[hsl(var(--primary))]',
      )}
      aria-hidden="true"
    >
      <Icon className="w-4 h-4" aria-hidden />
    </div>
  )
}

// ─── ScheduleListItem ─────────────────────────────────────────────────────────

function ScheduleListItem({
  schedule,
  projectName,
  selected = false,
}: {
  schedule: Schedule
  /** When provided, display the owning project name on the card (used in the "all projects" view) */
  projectName?: string
  /** Highlights the row with a grayscale wash when its detail is being viewed. */
  selected?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const countdown = useScheduleCountdown(schedule.nextRunAt)
  const navigateToSchedule = useAppStore((s) => s.navigateToSchedule)

  const subtitle = schedule.description || formatFrequencySummary(schedule, t, EVENT_TRIGGER_OPTIONS)
  const Icon = getScheduleTriggerIcon(schedule)
  const statusKey = schedule.status

  return (
    <div
      // `data-schedule-row` is the swap-zone marker read by the schedule
      // preview overlay's outside-click handler — clicking another row
      // swaps the panel content instead of dismissing it.
      data-schedule-row=""
      className={cn(ROW_BASE, selected && ROW_SELECTED)}
      onClick={() => navigateToSchedule(schedule.id)}
    >
      <RowIcon Icon={Icon} />

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate text-[hsl(var(--foreground))]">{schedule.name}</div>
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

      <div className="shrink-0 flex flex-col items-end gap-0.5">
        <div className="inline-flex items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[statusKey], statusKey === 'active' && 'animate-pulse')}
            aria-hidden="true"
          />
          <span className={cn('text-xs font-medium', STATUS_TEXT_CLASS[statusKey])}>
            {t(`status.${statusKey}`)}
          </span>
        </div>
        {statusKey === 'active' && (
          <div className="text-[11px] tabular-nums text-[hsl(var(--muted-foreground)/0.8)]">{countdown}</div>
        )}
      </div>
    </div>
  )
}

// ─── PipelineListItem ─────────────────────────────────────────────────────────

function PipelineListItem({
  pipeline,
  projectName,
}: {
  pipeline: SchedulePipeline
  projectName?: string
}): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const statusKey = pipeline.status

  return (
    <div
      className={ROW_BASE}
      onClick={() => {
        // TODO: Open pipeline detail
      }}
    >
      <RowIcon Icon={Workflow} tone="pipeline" />

      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate text-[hsl(var(--foreground))]">{pipeline.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">
            {pipeline.steps.length} {t('steps')}
          </span>
          {projectName && (
            <>
              <span className="text-[hsl(var(--muted-foreground)/0.4)] shrink-0">·</span>
              <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] shrink-0 truncate max-w-[120px]">
                {projectName}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 inline-flex items-center gap-1.5">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[statusKey])}
          aria-hidden="true"
        />
        <span className={cn('text-xs font-medium', STATUS_TEXT_CLASS[statusKey])}>
          {t(`status.${statusKey}`)}
        </span>
      </div>
    </div>
  )
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: React.ReactNode
  title: string
  count: number
}): React.JSX.Element {
  return (
    <div className="mb-2 flex items-baseline gap-1.5">
      <span className="shrink-0 self-center text-[hsl(var(--muted-foreground))]" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-[13px] font-medium text-[hsl(var(--foreground)/0.85)]">{title}</h2>
      <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.7)] tabular-nums">{count}</span>
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
        {t('filter.all', { defaultValue: 'All' })}
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

  // Schedule detail is shown as a non-modal right-side popover.  The
  // list stays visible and clickable underneath — picking another row
  // swaps the popover content without first closing it (driven by the
  // store's `detailContext`, which `navigateToSchedule` updates).
  const detailContext = useAppStore((s) => s.detailContext)
  const closeDetail = useAppStore((s) => s.closeDetail)
  const selectedScheduleId =
    detailContext?.type === 'schedule' ? detailContext.scheduleId : null

  // Closing the popover also clears `scheduleStore.selectedScheduleId` —
  // `navigateToSchedule` set both in lockstep, so closing must do the
  // same to keep external consumers (global search, etc.) consistent.
  const setSelectedScheduleId = useScheduleStore((s) => s.setSelectedScheduleId)
  const handleClosePreview = () => {
    closeDetail()
    setSelectedScheduleId(null)
  }

  // Schedule list follows the current sidebar project context:
  // - All Projects (projectId = null): global list + local filter bar
  // - Specific project: project-scoped list, filter bar hidden
  const allSchedules = useScheduleStore((s) => s.schedules)
  const allPipelines = useScheduleStore((s) => s.pipelines)
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)

  const [showForm, setShowForm] = useState(false)
  const [showAICreator, setShowAICreator] = useState(false)
  // Local filter only applies to All Projects scope.
  const [allProjectsFilterProjectId, setAllProjectsFilterProjectId] = useState<string | null>(null)

  // Single source of truth for scope semantics.
  const scope = useMemo(
    () => resolveScheduleScope(selectedProjectId, allProjectsFilterProjectId),
    [selectedProjectId, allProjectsFilterProjectId]
  )
  const effectiveFilterProjectId = useMemo(
    () => effectiveProjectIdFromScope(scope),
    [scope]
  )

  // Project filter bar is shown only in All Projects scope.
  const showFilterBar = scope.kind === 'all-projects' && projects.length > 0

  // Filter by effective project scope.
  const schedules = useMemo(
    () => effectiveFilterProjectId
      ? allSchedules.filter((s) => s.projectId === effectiveFilterProjectId)
      : allSchedules,
    [allSchedules, effectiveFilterProjectId]
  )
  const pipelines = useMemo(
    () => effectiveFilterProjectId
      ? allPipelines.filter((p) => p.projectId === effectiveFilterProjectId)
      : allPipelines,
    [allPipelines, effectiveFilterProjectId]
  )

  // In the "all" view, look up the project name for each schedule to display
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return map
  }, [projects])

  const activeSchedules = schedules.filter((s) => s.status === 'active')
  const pausedSchedules = schedules.filter((s) => s.status === 'paused')
  const selectedProject = useMemo(
    () => scope.kind === 'project'
      ? projects.find((p) => p.id === scope.projectId) ?? null
      : null,
    [projects, scope]
  )

  // In the true "all projects" view, annotate cards with owning project names.
  const isAllProjectsView =
    scope.kind === 'all-projects' &&
    scope.filterProjectId === null &&
    projects.length > 1

  return (
    <div className="h-full flex flex-col">
      {/* Page header — mirrors the Starred page's top-left treatment:
          two-line title + small count + subtitle stacked in a column,
          with action CTAs floated on the right.  No bottom border —
          spacing alone carries the separation to the filter row below. */}
      <div className="flex items-start justify-between gap-4 px-5 pt-3 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
              {t('title')}
            </h1>
            <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
              {schedules.length}
            </span>
            {/* Project / active hint — kept on the title row so the
                "where" + "how many running" info stays a glance away
                without breaking the Starred-style two-line shape. */}
            {(selectedProject || activeSchedules.length > 0) && (
              <span className="truncate text-xs text-[hsl(var(--muted-foreground)/0.7)]">
                {selectedProject?.name ?? t('filter.allProjects', { defaultValue: 'All Projects' })}
                {activeSchedules.length > 0 && (
                  <>
                    <span className="mx-1.5 text-[hsl(var(--muted-foreground)/0.4)]">·</span>
                    {activeSchedules.length} {t('active').toLowerCase()}
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* AI Create schedule button */}
          <button
            onClick={() => setShowAICreator(true)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[hsl(var(--ai))] hover:bg-[hsl(var(--ai)/0.1)] transition-colors text-xs font-medium"
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

      {/* Project filter bar — only shown in All Projects context */}
      {showFilterBar && (
        <ProjectFilterBar
          selected={scope.kind === 'all-projects' ? scope.filterProjectId : null}
          onSelect={setAllProjectsFilterProjectId}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {schedules.length === 0 && pipelines.length === 0 ? (
          <ScheduleEmptyState
            onCreate={() => setShowForm(true)}
            onAICreate={() => setShowAICreator(true)}
            isFilteredEmpty={
              scope.kind === 'all-projects' &&
              scope.filterProjectId !== null &&
              (allSchedules.length > 0 || allPipelines.length > 0)
            }
            onClearFilter={() => setAllProjectsFilterProjectId(null)}
          />
        ) : (
          <div className="space-y-5">
            {activeSchedules.length > 0 && (
              <section>
                <SectionHeader
                  icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                  title={t('active')}
                  count={activeSchedules.length}
                />
                <div className="space-y-1">
                  {activeSchedules
                    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
                    .map((s) => (
                      <ScheduleListItem
                        key={s.id}
                        schedule={s}
                        selected={s.id === selectedScheduleId}
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
                <SectionHeader
                  icon={<Pause className="h-3.5 w-3.5" aria-hidden="true" />}
                  title={t('paused')}
                  count={pausedSchedules.length}
                />
                <div className="space-y-1">
                  {pausedSchedules.map((s) => (
                    <ScheduleListItem
                      key={s.id}
                      schedule={s}
                      selected={s.id === selectedScheduleId}
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
                <SectionHeader
                  icon={<Workflow className="h-3.5 w-3.5" aria-hidden="true" />}
                  title={t('pipelines')}
                  count={pipelines.length}
                />
                <div className="space-y-1">
                  {pipelines.map((p) => (
                    <PipelineListItem
                      key={p.id}
                      pipeline={p}
                      projectName={isAllProjectsView && p.projectId
                        ? projectNameById.get(p.projectId)
                        : undefined}
                    />
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

      {/* Non-modal schedule detail popover.  Mirrors the Issues list
          pattern: list stays interactive, picking another row swaps the
          panel content in place. */}
      {selectedScheduleId && (
        <SchedulePreviewOverlay
          scheduleId={selectedScheduleId}
          onClose={handleClosePreview}
          modal={false}
        />
      )}
    </div>
  )
}

// ─── ScheduleEmptyState ──────────────────────────────────────────────────────

interface ScheduleEmptyStateProps {
  onCreate: () => void
  onAICreate: () => void
  /** True when at least one schedule/pipeline exists, but the active
   *  project filter narrows the visible list to zero.  Switches the
   *  copy + CTAs to a "filtered" recovery flow. */
  isFilteredEmpty: boolean
  /** Clears the All-Projects project filter (only relevant in filtered mode). */
  onClearFilter: () => void
}

/**
 * Empty-surface state for the schedule list.  Visual style mirrors the
 * Issues view's empty state — a plain `h-12 w-12 opacity-30` icon over a
 * compact title/subtitle/CTA stack — so the two empty experiences feel
 * cut from the same cloth.
 *
 * Two modes:
 *   - `noneYet`  : no schedules / pipelines in scope at all.  Offers
 *                  manual + AI creation entry points (mirroring the
 *                  toolbar buttons so the empty surface and the busy
 *                  surface share affordances).
 *   - `filtered` : items exist globally but the active project filter
 *                  hides everything.  Surfaces a single "clear filter"
 *                  recovery action rather than tempting the user to
 *                  create yet another schedule they may not need.
 */
function ScheduleEmptyState({
  onCreate,
  onAICreate,
  isFilteredEmpty,
  onClearFilter,
}: ScheduleEmptyStateProps): React.JSX.Element {
  const { t } = useTranslation('schedule')

  if (isFilteredEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center text-[hsl(var(--muted-foreground))] h-full">
        <SearchX className="h-12 w-12 opacity-30" aria-hidden="true" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
            {t('emptyState.filtered.title')}
          </h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-sm leading-relaxed">
            {t('emptyState.filtered.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClearFilter}
          className={cn(
            'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium mt-1',
            'border border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
            'hover:bg-[hsl(var(--foreground)/0.04)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          )}
        >
          {t('emptyState.filtered.clearCta')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center text-[hsl(var(--muted-foreground))] h-full">
      <CalendarClock className="h-12 w-12 opacity-30" aria-hidden="true" />
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">
          {t('emptyState.noneYet.title')}
        </h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] max-w-sm leading-relaxed">
          {t('emptyState.noneYet.subtitle')}
        </p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={onCreate}
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
        <button
          type="button"
          onClick={onAICreate}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium',
            'text-[hsl(var(--ai))] hover:bg-[hsl(var(--ai)/0.1)] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          )}
        >
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          {t('emptyState.noneYet.aiCta')}
        </button>
      </div>
    </div>
  )
}
