// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Archive, Folder, MoreVertical, Pin, Search, X } from 'lucide-react'
import type { Project, ProjectGroup } from '@shared/types'
import { useAppStore } from '@/stores/appStore'
import { useLiveSessionCounts } from '@/stores/commandStore'
import { useGroupedProjects } from '@/hooks/useGroupedProjects'
import { useDeleteProject } from '@/hooks/useDeleteProject'
import { useRenameProject } from '@/hooks/useRenameProject'
import { cn } from '@/lib/utils'
import { AddProjectPopover } from '@/components/Sidebar/AddProjectPopover'
import { CreateProjectDialog } from '@/components/Sidebar/CreateProjectDialog'
import { ImportProjectsDialog } from '@/components/Sidebar/ImportProjectsDialog'
import { DeleteProjectDialog } from '@/components/Sidebar/DeleteProjectDialog'
import { ProjectContextMenu, type ProjectContextMenuState } from '@/components/Sidebar/ProjectContextMenu'
import { ProjectSettingsModal } from '@/components/ProjectSettings/ProjectSettingsModal'

// ─── Types ───────────────────────────────────────────────────────────

type ListTab = 'active' | 'archived'

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Replace the user's home directory prefix with `~` for display.
 * Falls back to the original path when `homeDir` is unknown or doesn't match.
 */
function tildify(path: string, homeDir: string | null): string {
  if (!homeDir) return path
  if (path === homeDir) return '~'
  if (path.startsWith(homeDir + '/')) return '~' + path.slice(homeDir.length)
  return path
}

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Blueprint-grid icon-panel background.
 *
 * Aligned with the Evose prototype recipe:
 *   - 20×20 grid lines at 3.5% foreground opacity
 *   - solid `--muted` base color (no transparency, so the inset shadow can
 *     cleanly cover edge-bleeding grid lines on responsive widths)
 *   - inset shadow 4px in matching `--muted` trims the outer 4px ring
 */
const ICON_PANEL_BG: React.CSSProperties = {
  background:
    'linear-gradient(to right, hsl(var(--foreground) / 0.035) 1px, transparent 1px), ' +
    'linear-gradient(to bottom, hsl(var(--foreground) / 0.035) 1px, transparent 1px), ' +
    'hsl(var(--muted))',
  backgroundSize: '20px 20px',
  boxShadow: 'inset 0 0 0 4px hsl(var(--muted))',
}

// ─── More button (hover-revealed) ────────────────────────────────────

interface MoreButtonProps {
  onOpen: (rect: DOMRect) => void
}

function MoreButton({ onOpen }: MoreButtonProps): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      aria-label="More actions"
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        const rect = ref.current?.getBoundingClientRect()
        if (rect) onOpen(rect)
      }}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md',
        'text-[hsl(var(--muted-foreground))] outline-none transition-colors',
        'hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]',
        'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
    >
      <MoreVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

// ─── Pinned tile (200×180 horizontal strip card) ─────────────────────

interface PinTileProps {
  project: Project
  liveSessionCount: number
  isRenaming: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMoreOpen: (rect: DOMRect) => void
  onRenameConfirm: (newName: string) => void
  onRenameCancel: () => void
  sessionLabel: string
  displayPath: string
}

function PinTile({
  project,
  liveSessionCount,
  isRenaming,
  onSelect,
  onContextMenu,
  onMoreOpen,
  onRenameConfirm,
  onRenameCancel,
  sessionLabel,
  displayPath,
}: PinTileProps): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (isRenaming) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group/pin-tile relative flex h-[180px] w-[200px] shrink-0 cursor-pointer flex-col overflow-hidden',
        'rounded-2xl border border-[hsl(var(--border)/0.55)] bg-[hsl(var(--card))]',
        'transition-all duration-200',
        'hover:-translate-y-[5px] hover:shadow-[0_4px_12px_0_hsl(var(--foreground)/0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
      aria-label={project.name}
    >
      {/* ⋯ menu — top-right, reveals on hover */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-[8px] top-[8px] z-10 opacity-0 transition-opacity duration-150 group-hover/pin-tile:opacity-100 focus-within:opacity-100"
      >
        <div className="rounded-md bg-[hsl(var(--card))] shadow-sm">
          <MoreButton onOpen={onMoreOpen} />
        </div>
      </div>

      {/* Icon panel — blueprint grid + 40×40 inner container */}
      <div
        className="flex h-[80px] w-full shrink-0 items-center justify-center overflow-hidden"
        style={ICON_PANEL_BG}
      >
        <div
          className={cn(
            'flex h-[40px] w-[40px] items-center justify-center rounded-xl',
            'border border-[hsl(var(--border))] bg-[hsl(var(--background))]',
            'transition-transform duration-500',
            'group-hover/pin-tile:-translate-y-[3px] group-hover/pin-tile:scale-110',
          )}
        >
          <Folder className="h-5 w-5 text-[hsl(var(--foreground))]" aria-hidden="true" />
        </div>
      </div>

      {/* Info */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        {isRenaming ? (
          <input
            autoFocus
            type="text"
            defaultValue={project.name}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onRenameConfirm((e.target as HTMLInputElement).value)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onRenameCancel()
              }
              e.stopPropagation()
            }}
            onBlur={(e) => onRenameConfirm(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'w-full text-sm font-medium bg-transparent outline-none',
              'border-b border-[hsl(var(--primary)/0.5)] focus:border-[hsl(var(--primary))]',
            )}
          />
        ) : (
          <div
            className="truncate text-sm font-medium text-[hsl(var(--foreground))]"
            title={project.name}
          >
            {project.name}
          </div>
        )}
        <div
          className="mt-1 truncate text-[11px] leading-[1.5] text-[hsl(var(--muted-foreground))]"
          title={project.path}
        >
          {liveSessionCount > 0 ? sessionLabel : displayPath}
        </div>
      </div>
    </div>
  )
}

// ─── Project Card (full grid card) ───────────────────────────────────

interface ProjectCardProps {
  project: Project
  group: ProjectGroup
  liveSessionCount: number
  isRenaming: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMoreOpen: (rect: DOMRect) => void
  onRenameConfirm: (newName: string) => void
  onRenameCancel: () => void
  pinnedLabel: string
  sessionLabel: string
  displayPath: string
}

function ProjectCard({
  project,
  group,
  liveSessionCount,
  isRenaming,
  onSelect,
  onContextMenu,
  onMoreOpen,
  onRenameConfirm,
  onRenameCancel,
  pinnedLabel,
  sessionLabel,
  displayPath,
}: ProjectCardProps): React.JSX.Element {
  const isPinned = group === 'pinned'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (isRenaming) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group/proj-card relative cursor-pointer overflow-hidden',
        'rounded-2xl border border-[hsl(var(--border)/0.55)] bg-[hsl(var(--card))]',
        'transition-all duration-200',
        'hover:-translate-y-[5px] hover:shadow-[0_4px_12px_0_hsl(var(--foreground)/0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
      )}
      aria-label={`${project.name}${isPinned ? `, ${pinnedLabel}` : ''}`}
    >
      {/* Pinned badge — top-left */}
      {isPinned && (
        <div
          aria-label={pinnedLabel}
          title={pinnedLabel}
          className="absolute left-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-md bg-[hsl(var(--background))] text-amber-500 shadow-sm"
        >
          <Pin className="h-3 w-3 fill-current" aria-hidden="true" />
        </div>
      )}

      {/* ⋯ menu — top-right, reveals on hover */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-[10px] top-[10px] z-10 opacity-0 transition-opacity duration-150 group-hover/proj-card:opacity-100 focus-within:opacity-100"
      >
        <div className="rounded-md bg-[hsl(var(--card))] shadow-sm">
          <MoreButton onOpen={onMoreOpen} />
        </div>
      </div>

      {/* Icon panel — blueprint grid + 48×48 inner container */}
      <div
        className="flex h-[100px] w-full items-center justify-center overflow-hidden"
        style={ICON_PANEL_BG}
      >
        <div
          className={cn(
            'flex h-[48px] w-[48px] items-center justify-center rounded-xl',
            'border border-[hsl(var(--border))] bg-[hsl(var(--background))]',
            'transition-transform duration-500',
            'group-hover/proj-card:-translate-y-[5px] group-hover/proj-card:scale-110',
          )}
        >
          <Folder className="h-6 w-6 text-[hsl(var(--foreground))]" aria-hidden="true" />
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        {isRenaming ? (
          <input
            autoFocus
            type="text"
            defaultValue={project.name}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onRenameConfirm((e.target as HTMLInputElement).value)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onRenameCancel()
              }
              e.stopPropagation()
            }}
            onBlur={(e) => onRenameConfirm(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'w-full text-sm font-medium bg-transparent outline-none',
              'border-b border-[hsl(var(--primary)/0.5)] focus:border-[hsl(var(--primary))]',
            )}
          />
        ) : (
          <div
            className="truncate text-sm font-medium text-[hsl(var(--foreground))]"
            title={project.name}
          >
            {project.name}
          </div>
        )}
        <div
          className="mt-2 h-[38px] overflow-hidden text-xs leading-[1.5] text-[hsl(var(--muted-foreground))]"
          title={project.path}
        >
          <div className="line-clamp-2 break-all">{displayPath}</div>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-2 text-xs leading-[1.5] text-[hsl(var(--muted-foreground))]">
          {liveSessionCount > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"
                aria-hidden="true"
              />
              {sessionLabel}
            </span>
          ) : (
            <span className="text-[hsl(var(--muted-foreground)/0.7)]">·</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main View ───────────────────────────────────────────────────────

export function ProjectsListView(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const projects = useAppStore((s) => s.projects)
  const navigateToProject = useAppStore((s) => s.navigateToProject)
  const homeDir = useAppStore((s) => s.homeDir)
  const ensureHomeDir = useAppStore((s) => s.ensureHomeDir)
  const liveCounts = useLiveSessionCounts()
  const grouped = useGroupedProjects()

  // Sidebar normally resolves $HOME first, but this view can render
  // before the Sidebar mounts (e.g. directly after onboarding), so
  // request it here too — ensureHomeDir is idempotent.
  useEffect(() => {
    if (homeDir === null) void ensureHomeDir()
  }, [homeDir, ensureHomeDir])

  const [tab, setTab] = useState<ListTab>('active')
  const [query, setQuery] = useState('')

  const { renamingProjectId, startRename, confirmRename, cancelRename } = useRenameProject()
  const { pendingProject, dialogOpen, requestDelete, confirmDelete, cancelDelete } = useDeleteProject()

  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const trimmedQuery = query.trim().toLowerCase()
  const matchesQuery = useCallback(
    (p: Project): boolean =>
      !trimmedQuery ||
      p.name.toLowerCase().includes(trimmedQuery) ||
      p.path.toLowerCase().includes(trimmedQuery),
    [trimmedQuery],
  )

  // Pinned strip sits ABOVE the search box — it's a persistent shortcut
  // row that always shows all pinned projects, independent of both the
  // active/archived tab and the search keyword. The search is scoped to
  // the list below it.
  const pinnedVisible = grouped.pinned
  // Main grid: active = all non-archived (pinned + regular), archived = archived only.
  // The search keyword narrows only this list.
  const mainVisible = useMemo(() => {
    const base = tab === 'active' ? [...grouped.pinned, ...grouped.projects] : grouped.archived
    return base.filter(matchesQuery)
  }, [tab, grouped.pinned, grouped.projects, grouped.archived, matchesQuery])

  const groupForProject = useCallback((project: Project): ProjectGroup => {
    if (project.pinOrder !== null) return 'pinned'
    if (project.archivedAt !== null) return 'archived'
    return 'projects'
  }, [])

  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, project: Project) => {
      e.preventDefault()
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        project,
        group: groupForProject(project),
      })
    },
    [groupForProject],
  )

  const handleMoreOpen = useCallback(
    (rect: DOMRect, project: Project) => {
      // Anchor menu at button's bottom-right; ProjectContextMenu's viewport
      // clamp will flip it leftward if it overflows.
      setContextMenu({
        position: { x: rect.right, y: rect.bottom },
        project,
        group: groupForProject(project),
      })
    },
    [groupForProject],
  )

  const totalActive = grouped.pinned.length + grouped.projects.length
  const totalArchived = grouped.archived.length
  // Empty state belongs to the main grid (below the filter row) — pinned
  // strip lives above the filter and has its own visibility logic.
  const showEmpty = mainVisible.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="shrink-0">
        <div className="drag-region flex items-start justify-between gap-4 px-5 pt-3 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {t('projectsList.title')}
              </h1>
              <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
                {projects.length}
              </span>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t('projectsList.subtitle')}
            </p>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-2">
            <AddProjectPopover
              onRequestCreateProject={() => setCreateOpen(true)}
              onRequestImportProjects={() => setImportOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Scroll container — pinned strip + sticky filter + grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Pinned strip */}
        {pinnedVisible.length > 0 && (
          <Section
            icon={<Pin className="h-3.5 w-3.5" aria-hidden="true" />}
            title={t('projectsList.pinnedSection')}
            count={pinnedVisible.length}
          >
            <HorizontalStrip>
              {pinnedVisible.map((project) => (
                <PinTile
                  key={project.id}
                  project={project}
                  liveSessionCount={liveCounts[project.id] ?? 0}
                  isRenaming={renamingProjectId === project.id}
                  onSelect={() => navigateToProject(project.id)}
                  onContextMenu={(e) => handleCardContextMenu(e, project)}
                  onMoreOpen={(rect) => handleMoreOpen(rect, project)}
                  onRenameConfirm={(name) => void confirmRename(name)}
                  onRenameCancel={cancelRename}
                  sessionLabel={t('projectsList.sessionCount', { count: liveCounts[project.id] ?? 0 })}
                  displayPath={tildify(project.path, homeDir)}
                />
              ))}
            </HorizontalStrip>
          </Section>
        )}

        {/* Filter row — sticky at top of scroll area when grid scrolls */}
        <div className="sticky top-0 z-10 mt-4 flex items-center gap-1.5 bg-[hsl(var(--card))] px-5 py-2">
          <div className="relative w-[260px]">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('projectsList.searchPlaceholder')}
              aria-label={t('projectsList.searchPlaceholder')}
              className={cn(
                'h-9 w-full rounded-md border border-transparent bg-[hsl(var(--muted)/0.5)]',
                'pl-8 pr-7 text-sm text-[hsl(var(--foreground))] outline-none',
                'placeholder:text-[hsl(var(--muted-foreground))]',
                'transition-colors hover:bg-[hsl(var(--muted))]',
                'focus:border-[hsl(var(--border))] focus:bg-[hsl(var(--background))]',
              )}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className={cn(
                  'absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center',
                  'rounded text-[hsl(var(--muted-foreground))] transition-colors',
                  'hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Status segmented */}
          <div
            role="tablist"
            aria-label={t('projectsList.title')}
            className="inline-flex h-9 rounded-md border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--muted)/0.4)] p-0.5"
          >
            <SegmentButton
              active={tab === 'active'}
              onClick={() => setTab('active')}
              icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('projectsList.tabActive')}
              count={totalActive}
            />
            <SegmentButton
              active={tab === 'archived'}
              onClick={() => setTab('archived')}
              icon={<Archive className="h-3.5 w-3.5" aria-hidden="true" />}
              label={t('projectsList.tabArchived')}
              count={totalArchived}
            />
          </div>
        </div>

        {/* Grid */}
        {showEmpty ? (
          <EmptyState
            hasKeyword={!!trimmedQuery}
            tab={tab}
            onClearKeyword={() => setQuery('')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {mainVisible.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                group={groupForProject(project)}
                liveSessionCount={liveCounts[project.id] ?? 0}
                isRenaming={renamingProjectId === project.id}
                onSelect={() => navigateToProject(project.id)}
                onContextMenu={(e) => handleCardContextMenu(e, project)}
                onMoreOpen={(rect) => handleMoreOpen(rect, project)}
                onRenameConfirm={(name) => void confirmRename(name)}
                onRenameCancel={cancelRename}
                pinnedLabel={t('projectsList.pinned')}
                sessionLabel={t('projectsList.sessionCount', { count: liveCounts[project.id] ?? 0 })}
                displayPath={tildify(project.path, homeDir)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals & menus */}
      {contextMenu && (
        <ProjectContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          onRenameRequest={startRename}
          onDeleteRequest={requestDelete}
          onSettingsRequest={setSettingsProjectId}
        />
      )}
      <DeleteProjectDialog
        project={pendingProject}
        open={dialogOpen}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
      {settingsProjectId && (
        <ProjectSettingsModal
          projectId={settingsProjectId}
          onClose={() => setSettingsProjectId(null)}
        />
      )}
      <CreateProjectDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportProjectsDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon?: React.ReactNode
  title: string
  count?: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="px-5 pt-4">
      <div className="mb-2 flex items-baseline gap-1.5">
        {icon && (
          <span className="shrink-0 self-center text-[hsl(var(--muted-foreground))]" aria-hidden="true">
            {icon}
          </span>
        )}
        <h2 className="text-[13px] font-medium text-[hsl(var(--foreground)/0.85)]">{title}</h2>
        {count !== undefined && (
          <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.7)] tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function HorizontalStrip({ children }: { children: React.ReactNode }): React.JSX.Element {
  // overflow-x-auto implicitly clips overflow-y; pt-2 reserves room for the
  // -5px hover lift so the upper edge of cards isn't trimmed.
  return (
    <div
      className="flex gap-3 overflow-x-auto pt-2 pb-3"
      style={{ scrollbarWidth: 'thin' }}
    >
      {children}
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
}): React.JSX.Element {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-3 text-xs transition-colors',
        active
          ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
          : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}

function EmptyState({
  hasKeyword,
  tab,
  onClearKeyword,
}: {
  hasKeyword: boolean
  tab: ListTab
  onClearKeyword: () => void
}): React.JSX.Element {
  const { t } = useTranslation('navigation')
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--muted)/0.6)] text-[hsl(var(--muted-foreground))]">
        <Folder className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="text-sm text-[hsl(var(--foreground)/0.85)]">
        {hasKeyword
          ? t('projectsList.noSearchMatch')
          : tab === 'active'
            ? t('projectsList.emptyActive')
            : t('projectsList.emptyArchived')}
      </div>
      {hasKeyword && (
        <button
          type="button"
          onClick={onClearKeyword}
          className="text-sm text-[hsl(var(--primary))] hover:underline"
        >
          <X className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Clear search
        </button>
      )}
    </div>
  )
}
