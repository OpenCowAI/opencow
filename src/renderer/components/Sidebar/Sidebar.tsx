// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useCommandStore, useLiveSessionCounts } from '@/stores/commandStore'
import { cn } from '@/lib/utils'
import { useGroupedProjects } from '@/hooks/useGroupedProjects'
import { useProjectDnd, DROPPABLE_PINNED, DROPPABLE_PROJECTS } from '@/hooks/useProjectDnd'
import { useDeleteProject } from '@/hooks/useDeleteProject'
import { useRenameProject } from '@/hooks/useRenameProject'
import { usePopover } from '@/hooks/usePopover'
import type { Project, ProjectGroup } from '@shared/types'
import { FolderGit2, Home, ChevronLeft, ChevronRight, Star, Package } from 'lucide-react'
import { surfaceProps } from '@/lib/surface'
import { Tooltip } from '@/components/ui/Tooltip'
import { InboxWidget } from './InboxWidget'
import { ScheduleWidget } from './ScheduleWidget'
import { AppInfoWidget } from './AppInfoWidget'
import { ProjectContextMenu, type ProjectContextMenuState } from './ProjectContextMenu'
import { DeleteProjectDialog } from './DeleteProjectDialog'
import { AddProjectPopover } from './AddProjectPopover'
import { CreateProjectDialog } from './CreateProjectDialog'
import { ImportProjectsDialog } from './ImportProjectsDialog'

const PROJECTS_POPOVER_GAP = 8
const PROJECTS_POPOVER_CLOSE_DELAY_MS = 120

// === Section Header ===

function SectionHeader({
  icon,
  label,
  count,
  collapsed,
  onToggle
}: {
  icon: React.ReactNode
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
    >
      <ChevronRight
        className={cn('h-3 w-3 shrink-0 transition-transform', !collapsed && 'rotate-90')}
        aria-hidden="true"
      />
      <span className="flex items-center gap-1" aria-hidden="true">
        {icon}
      </span>
      <span>
        {label} ({count})
      </span>
    </button>
  )
}

// === Project Item (base rendering) ===

interface ProjectItemProps {
  project: Project
  group: ProjectGroup
  isSelected: boolean
  isNew: boolean
  /** Real-time live session count (from managed session state). */
  liveSessionCount: number
  /** Whether this item is in inline-edit (rename) mode. */
  isRenaming: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameConfirm: (newName: string) => void
  onRenameCancel: () => void
  t: TFunction<'navigation'>
}

function ProjectItem({
  project,
  group,
  isSelected,
  isNew,
  liveSessionCount,
  isRenaming,
  onSelect,
  onContextMenu,
  onRenameConfirm,
  onRenameCancel,
  t
}: ProjectItemProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus and select text when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isRenaming])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onRenameConfirm(inputRef.current?.value ?? '')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onRenameCancel()
    }
  }

  const handleBlur = (): void => {
    // Commit on blur (same as Enter)
    onRenameConfirm(inputRef.current?.value ?? '')
  }

  if (isRenaming) {
    return (
      <div className="w-full flex items-center px-1 py-0.5 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 min-w-0 w-full">
          <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            defaultValue={project.name}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'flex-1 min-w-0 bg-transparent outline-none text-sm',
              'border-b border-[hsl(var(--primary)/0.5)]',
              'focus:border-[hsl(var(--primary))]',
              'placeholder:text-[hsl(var(--muted-foreground)/0.4)]',
            )}
          />
        </span>
      </div>
    )
  }

  return (
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        'group w-full flex items-center px-1 py-0.5 text-sm transition-colors',
        isNew && 'animate-pulse'
      )}
      aria-label={`${project.name}${group === 'pinned' ? t('projectActions.pinned') : ''}${group === 'archived' ? t('projectActions.archivedSuffix') : ''}`}
    >
      <span
        className={cn(
          'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors min-w-0',
          'group-hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
          isSelected && 'font-bold'
        )}
      >
        <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-left">{project.name}</span>
      </span>
      {liveSessionCount > 0 && (
        <span className="ml-auto shrink-0 text-xs tabular-nums bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full px-1.5 py-0.5">
          {liveSessionCount}
        </span>
      )}
    </button>
  )
}

// === Sortable Project Item (DnD wrapper) ===

function SortableProjectItem(props: ProjectItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.project.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectItem {...props} />
    </div>
  )
}

// === Project Drag Overlay ===

function ProjectDragOverlay({ project }: { project: Project }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[hsl(var(--card))] shadow-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))]">
      <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{project.name}</span>
    </div>
  )
}

// === Droppable Section Container ===

function DroppableSection({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}): React.JSX.Element {
  const { setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef}>{children}</div>
}

function SidebarToggleFooter({
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
}: {
  expanded: boolean
  onToggle: () => void
  expandLabel: string
  collapseLabel: string
}): React.JSX.Element {
  const label = expanded ? collapseLabel : expandLabel
  const button = (
    <button
      onClick={onToggle}
      className={cn(
        'no-drag rounded-md transition-colors',
        'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
        expanded
          ? 'w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs'
          : 'h-8 w-8 flex items-center justify-center',
      )}
      aria-label={label}
      title={label}
    >
      {expanded ? (
        <>
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{collapseLabel}</span>
        </>
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  )

  return (
    <div className={cn(
      'shrink-0 border-t border-[hsl(var(--sidebar-border)/0.35)] p-1.5',
      !expanded && 'flex items-center justify-center',
    )}>
      {expanded ? (
        button
      ) : (
        <Tooltip content={expandLabel} position="right" align="center">
          {button}
        </Tooltip>
      )}
    </div>
  )
}

// === Main Sidebar ===

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const appView = useAppStore((s) => s.appView)
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const navigateToProject = useAppStore((s) => s.navigateToProject)
  const showArchived = useAppStore((s) => s.showArchived)
  const toggleShowArchived = useAppStore((s) => s.toggleShowArchived)
  const leftSidebarExpanded = useAppStore((s) => s.leftSidebarExpanded)
  const setLeftSidebarExpanded = useAppStore((s) => s.setLeftSidebarExpanded)
  // Live session counts per project — computed inside a Zustand selector with
  // `shallow` equality on a flat Record<string, number>.  The selector runs on
  // every store change, but the component only re-renders when the computed
  // counts actually differ (i.e. a session transitions in/out of a live state).
  // During streaming, session.state stays 'streaming' → counts are stable → no re-render.
  const liveCounts = useLiveSessionCounts()

  /** Resolve display count from managed sessions. */
  function getProjectLiveSessionCount(project: Project): number {
    return liveCounts[project.id] ?? 0
  }

  // Rename flow — fully encapsulated in hook (SRP: Sidebar owns display, hook owns logic)
  const { renamingProjectId, startRename, confirmRename, cancelRename } = useRenameProject()

  // Delete flow — fully encapsulated in hook (SRP: Sidebar owns display, hook owns logic)
  const { pendingProject, dialogOpen, requestDelete, confirmDelete, cancelDelete } = useDeleteProject()
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false)
  const [importProjectsDialogOpen, setImportProjectsDialogOpen] = useState(false)

  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  // New project detection (pulse animation)
  const knownProjectIdsRef = useRef<Set<string>>(new Set())
  const [newProjectIds, setNewProjectIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(projects.map((p) => p.id))
    const known = knownProjectIdsRef.current

    if (known.size > 0) {
      const newIds = new Set<string>()
      for (const id of currentIds) {
        if (!known.has(id)) {
          newIds.add(id)
        }
      }
      if (newIds.size > 0) {
        setNewProjectIds(newIds)
        const timer = setTimeout(() => setNewProjectIds(new Set()), 3000)
        return () => clearTimeout(timer)
      }
    }

    knownProjectIdsRef.current = currentIds
  }, [projects])

  const grouped = useGroupedProjects()

  const toggleSidebarExpanded = useCallback(() => {
    setLeftSidebarExpanded(!leftSidebarExpanded)
  }, [leftSidebarExpanded, setLeftSidebarExpanded])

  // "All Projects" is active only in project mode with null projectId.
  // Inbox and Schedule have their own dedicated nav items and should not
  // visually activate the "All Projects" entry.
  const isAllProjectsActive =
    appView.mode === 'projects' &&
    appView.projectId === null &&
    appView.tab !== 'schedule'

  const {
    open: projectsPopoverOpen,
    mounted: projectsPopoverMounted,
    triggerRef: projectsTriggerRef,
    contentRef: projectsPopoverRef,
    animCls: projectsPopoverAnimCls,
    openPopover: showProjectsPopover,
    toggle: toggleProjectsPopover,
    close: closeProjectsPopover,
    closeImmediate: closeProjectsPopoverImmediate,
  } = usePopover()
  const projectsPopoverCloseTimerRef = useRef<number | null>(null)
  const [projectsPopoverPos, setProjectsPopoverPos] = useState<{ x: number; y: number } | null>(null)

  const clearProjectsPopoverCloseTimer = useCallback(() => {
    if (projectsPopoverCloseTimerRef.current === null) return
    window.clearTimeout(projectsPopoverCloseTimerRef.current)
    projectsPopoverCloseTimerRef.current = null
  }, [])

  const handleRequestCreateProject = useCallback(() => {
    clearProjectsPopoverCloseTimer()
    closeProjectsPopoverImmediate()
    setCreateProjectDialogOpen(true)
  }, [clearProjectsPopoverCloseTimer, closeProjectsPopoverImmediate])

  const handleRequestImportProjects = useCallback(() => {
    clearProjectsPopoverCloseTimer()
    closeProjectsPopoverImmediate()
    setImportProjectsDialogOpen(true)
  }, [clearProjectsPopoverCloseTimer, closeProjectsPopoverImmediate])

  const openProjectsPopover = useCallback(() => {
    clearProjectsPopoverCloseTimer()
    showProjectsPopover()
  }, [clearProjectsPopoverCloseTimer, showProjectsPopover])

  const scheduleCloseProjectsPopover = useCallback(() => {
    clearProjectsPopoverCloseTimer()
    projectsPopoverCloseTimerRef.current = window.setTimeout(() => {
      closeProjectsPopover()
    }, PROJECTS_POPOVER_CLOSE_DELAY_MS)
  }, [clearProjectsPopoverCloseTimer, closeProjectsPopover])

  const updateProjectsPopoverPosition = useCallback(() => {
    if (!projectsTriggerRef.current || !projectsPopoverRef.current) return
    const triggerRect = projectsTriggerRef.current.getBoundingClientRect()
    const { width, height } = projectsPopoverRef.current.getBoundingClientRect()

    let x = triggerRect.right + PROJECTS_POPOVER_GAP
    let y = triggerRect.top

    if (x + width + PROJECTS_POPOVER_GAP > window.innerWidth) {
      x = Math.max(PROJECTS_POPOVER_GAP, triggerRect.left - width - PROJECTS_POPOVER_GAP)
    }

    if (y + height + PROJECTS_POPOVER_GAP > window.innerHeight) {
      y = Math.max(PROJECTS_POPOVER_GAP, window.innerHeight - height - PROJECTS_POPOVER_GAP)
    }

    setProjectsPopoverPos({ x, y })
  }, [projectsPopoverRef, projectsTriggerRef])

  useEffect(() => {
    if (leftSidebarExpanded) return
    setContextMenu(null)
    if (renamingProjectId) {
      cancelRename()
    }
  }, [leftSidebarExpanded, renamingProjectId, cancelRename])

  useEffect(() => {
    if (leftSidebarExpanded) {
      closeProjectsPopoverImmediate()
      setProjectsPopoverPos(null)
    }
  }, [leftSidebarExpanded, closeProjectsPopoverImmediate])

  useEffect(() => {
    return () => {
      clearProjectsPopoverCloseTimer()
    }
  }, [clearProjectsPopoverCloseTimer])

  useLayoutEffect(() => {
    if (!projectsPopoverMounted) return
    updateProjectsPopoverPosition()
  }, [projectsPopoverMounted, grouped.archived.length, grouped.pinned.length, grouped.projects.length, showArchived, updateProjectsPopoverPosition])

  useEffect(() => {
    if (!projectsPopoverMounted) return

    const handleViewportChange = (): void => {
      updateProjectsPopoverPosition()
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [projectsPopoverMounted, updateProjectsPopoverPosition])

  useEffect(() => {
    if (projectsPopoverMounted) return
    setProjectsPopoverPos(null)
  }, [projectsPopoverMounted])

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleContextMenu = useCallback((
    e: React.MouseEvent,
    project: Project,
    group: ProjectGroup
  ) => {
    e.preventDefault()
    setContextMenu({ position: { x: e.clientX, y: e.clientY }, project, group })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // ── DnD Setup ──

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const { state: dndState, onDragStart, onDragOver, onDragEnd, onDragCancel } = useProjectDnd(grouped)

  // Sortable IDs for each group
  const pinnedIds = useMemo(() => grouped.pinned.map((p) => p.id), [grouped.pinned])
  const projectIds = useMemo(() => grouped.projects.map((p) => p.id), [grouped.projects])

  // ── Shared props builder ──

  const makeItemProps = useCallback(
    (project: Project, group: ProjectGroup): ProjectItemProps => ({
      project,
      group,
      isSelected: selectedProjectId === project.id,
      isNew: newProjectIds.has(project.id),
      liveSessionCount: getProjectLiveSessionCount(project),
      isRenaming: renamingProjectId === project.id,
      onSelect: () => {
        navigateToProject(project.id)
        if (!leftSidebarExpanded) {
          closeProjectsPopover()
        }
      },
      onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, project, group),
      onRenameConfirm: (newName: string) => void confirmRename(newName),
      onRenameCancel: cancelRename,
      t,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedProjectId, newProjectIds, liveCounts, renamingProjectId, navigateToProject, leftSidebarExpanded, closeProjectsPopover, handleContextMenu, confirmRename, cancelRename, t]
  )

  // ── Non-sortable section renderer (for archived) ──

  const renderStaticSection = (
    group: ProjectGroup,
    items: Project[],
    icon: React.ReactNode,
    label: string,
    defaultCollapsed: boolean
  ): React.JSX.Element | null => {
    if (items.length === 0) return null
    const isCollapsed = collapsedSections[group] ?? defaultCollapsed
    return (
      <div key={group}>
        <SectionHeader
          icon={icon}
          label={label}
          count={items.length}
          collapsed={isCollapsed}
          onToggle={() => toggleSection(group)}
        />
        {!isCollapsed &&
          items.map((project) => (
            <ProjectItem key={project.id} {...makeItemProps(project, group)} />
          ))}
      </div>
    )
  }

  const renderProjectSections = (containerClassName: string): React.JSX.Element => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className={containerClassName}>
        {/* Pinned section */}
        {(grouped.pinned.length > 0 || dndState.overGroup === 'pinned') && (
          <div>
            <SectionHeader
              icon={<Star className="h-3 w-3" />}
              label={t('sidebar.pinned')}
              count={grouped.pinned.length}
              collapsed={collapsedSections.pinned ?? false}
              onToggle={() => toggleSection('pinned')}
            />
            {!(collapsedSections.pinned ?? false) && (
              <DroppableSection id={DROPPABLE_PINNED}>
                <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                  {grouped.pinned.map((project) => (
                    <SortableProjectItem key={project.id} {...makeItemProps(project, 'pinned')} />
                  ))}
                </SortableContext>
              </DroppableSection>
            )}
          </div>
        )}

        {/* Projects section */}
        {(grouped.projects.length > 0 || dndState.overGroup === 'projects') && (
          <div>
            <SectionHeader
              icon={<FolderGit2 className="h-3 w-3" />}
              label={t('sidebar.projects')}
              count={grouped.projects.length}
              collapsed={collapsedSections.projects ?? false}
              onToggle={() => toggleSection('projects')}
            />
            {!(collapsedSections.projects ?? false) && (
              <DroppableSection id={DROPPABLE_PROJECTS}>
                <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                  {grouped.projects.map((project) => (
                    <SortableProjectItem key={project.id} {...makeItemProps(project, 'projects')} />
                  ))}
                </SortableContext>
              </DroppableSection>
            )}
          </div>
        )}

        {/* Archived section (non-sortable) */}
        {showArchived &&
          renderStaticSection(
            'archived',
            grouped.archived,
            <Package className="h-3 w-3" />,
            t('sidebar.archived'),
            false
          )}
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
        {dndState.activeProject ? <ProjectDragOverlay project={dndState.activeProject} /> : null}
      </DragOverlay>
    </DndContext>
  )

  const projectDialogs = (
    <>
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onClose={() => setCreateProjectDialogOpen(false)}
      />
      <ImportProjectsDialog
        open={importProjectsDialogOpen}
        onClose={() => setImportProjectsDialogOpen(false)}
      />
    </>
  )

  if (!leftSidebarExpanded) {
    return (
      <aside
        {...surfaceProps({ elevation: 'raised', color: 'sidebar-background' })}
        className="h-full bg-[hsl(var(--sidebar-background))] border-r border-[hsl(var(--sidebar-border)/0.35)] flex flex-col overflow-visible"
      >
        {/* Drag region for macOS traffic lights */}
        <div className="drag-region pt-10 pb-1" />

        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label={t('sidebar.projectList')}>
          <div className="flex flex-col items-center gap-1">
            <Tooltip content={t('sidebar.allProjects')} position="right" align="center">
              <button
                onClick={() => {
                  clearProjectsPopoverCloseTimer()
                  navigateToProject(null)
                  closeProjectsPopover()
                }}
                className={cn(
                  'no-drag flex items-center justify-center h-8 w-8 rounded-md text-[hsl(var(--sidebar-foreground)/0.9)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.12)] transition-colors',
                  isAllProjectsActive && 'bg-[hsl(var(--sidebar-primary)/0.12)] text-[hsl(var(--sidebar-foreground))]',
                )}
                aria-label={t('sidebar.allProjects')}
                title={t('sidebar.allProjects')}
              >
                <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            </Tooltip>

            <button
              ref={projectsTriggerRef}
              onMouseEnter={openProjectsPopover}
              onMouseLeave={scheduleCloseProjectsPopover}
              onClick={() => {
                clearProjectsPopoverCloseTimer()
                toggleProjectsPopover()
              }}
              className={cn(
                'no-drag flex items-center justify-center h-8 w-8 rounded-md text-[hsl(var(--sidebar-foreground)/0.9)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.12)] transition-colors',
                (projectsPopoverOpen || selectedProjectId !== null) && 'bg-[hsl(var(--sidebar-primary)/0.12)] text-[hsl(var(--sidebar-foreground))]',
              )}
              aria-label={t('sidebar.projects')}
            >
              <FolderGit2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2 pt-2 border-t border-[hsl(var(--sidebar-border)/0.5)] space-y-1">
            <ScheduleWidget collapsed />
            <InboxWidget collapsed />
          </div>
        </nav>

        <div className="shrink-0">
          <AppInfoWidget collapsed />
          <SidebarToggleFooter
            expanded={false}
            onToggle={toggleSidebarExpanded}
            expandLabel={t('sidebar.expand')}
            collapseLabel={t('sidebar.collapse')}
          />
        </div>

        {/* DeleteProjectDialog is a pure display component; business logic is in useDeleteProject */}
        <DeleteProjectDialog
          project={pendingProject}
          open={dialogOpen}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
        {projectDialogs}

        {projectsPopoverMounted && createPortal(
          <div
            ref={projectsPopoverRef}
            onMouseEnter={openProjectsPopover}
            onMouseLeave={scheduleCloseProjectsPopover}
            {...surfaceProps({ elevation: 'floating', color: 'sidebar-background' })}
            className={cn(
              'fixed z-50 w-[280px] min-h-[240px] max-h-[70vh] rounded-xl border border-[hsl(var(--sidebar-border)/0.7)] bg-[hsl(var(--sidebar-background))] shadow-lg flex flex-col overflow-hidden',
              projectsPopoverAnimCls,
            )}
            style={{
              top: projectsPopoverPos?.y ?? -9999,
              left: projectsPopoverPos?.x ?? -9999,
              visibility: projectsPopoverPos ? 'visible' : 'hidden',
            }}
          >
            <div className="relative flex-1 min-h-0 overflow-y-auto p-2">
              <div className="absolute top-2 right-2 z-10">
                <AddProjectPopover
                  onRequestCreateProject={handleRequestCreateProject}
                  onRequestImportProjects={handleRequestImportProjects}
                />
              </div>

              {renderProjectSections('space-y-1')}

              {grouped.archived.length > 0 && (
                <button
                  onClick={toggleShowArchived}
                  className="w-full mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
                >
                  <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {showArchived ? t('hide', { ns: 'common' }) : t('show', { ns: 'common' })} {t('sidebar.archived').toLowerCase()} ({grouped.archived.length})
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      </aside>
    )
  }

  return (
    <aside {...surfaceProps({ elevation: 'raised', color: 'sidebar-background' })} className="h-full bg-[hsl(var(--sidebar-background))] flex flex-col">
      {/* Drag region for macOS traffic lights */}
      <div className="drag-region pt-10 pb-1" />

      <nav className="flex-1 overflow-y-auto p-2" aria-label={t('sidebar.projectList')}>
        {/* All Projects + Add button */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateToProject(null)}
            className="group flex-1 flex items-center px-1 py-0.5 text-sm transition-colors"
          >
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors min-w-0',
                'group-hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
                isAllProjectsActive && 'font-bold'
              )}
            >
              <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('sidebar.allProjects')}</span>
              {import.meta.env.DEV && (
                <span className="text-[10px] font-medium leading-none px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                  {t('sidebar.dev')}
                </span>
              )}
            </span>
          </button>
          <AddProjectPopover
            onRequestCreateProject={handleRequestCreateProject}
            onRequestImportProjects={handleRequestImportProjects}
          />
        </div>

        {/* Sortable project sections */}
        {renderProjectSections('mt-2 space-y-1')}

        {/* Archived toggle */}
        {grouped.archived.length > 0 && (
          <button
            onClick={toggleShowArchived}
            className="w-full mt-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
          >
            <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
            {showArchived ? t('hide', { ns: 'common' }) : t('show', { ns: 'common' })} {t('sidebar.archived').toLowerCase()} ({grouped.archived.length})
          </button>
        )}

        {/* Schedule + Inbox nav items */}
        <div className="mt-2 pt-2 border-t border-[hsl(var(--sidebar-border)/0.5)] space-y-0.5">
          <ScheduleWidget />
          <InboxWidget />
        </div>
      </nav>

      <div className="shrink-0">
        <AppInfoWidget />
        <SidebarToggleFooter
          expanded
          onToggle={toggleSidebarExpanded}
          expandLabel={t('sidebar.expand')}
          collapseLabel={t('sidebar.collapse')}
        />
      </div>

      {contextMenu && (
        <ProjectContextMenu
          state={contextMenu}
          onClose={closeContextMenu}
          onRenameRequest={startRename}
          onDeleteRequest={requestDelete}
        />
      )}

      {/* DeleteProjectDialog is a pure display component; business logic is in useDeleteProject */}
      <DeleteProjectDialog
        project={pendingProject}
        open={dialogOpen}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
      {projectDialogs}
    </aside>
  )
}
