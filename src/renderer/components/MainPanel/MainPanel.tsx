// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { useAppStore, selectMainTab, selectProjectId } from '@/stores/appStore'
import { useFileStore } from '@/stores/fileStore'
import { DashboardView } from '@/components/DashboardView/DashboardView'
import { IssuesView } from '@/components/IssuesView/IssuesView'
import { ChatView } from '@/components/ChatView/ChatView'
import { CapabilitiesView } from '@/components/ChatView/CapabilitiesView'
import { StarredArtifactsView } from '@/components/StarredArtifactsView/StarredArtifactsView'
import { ScheduleView } from '@/components/ScheduleView/ScheduleView'
import { MemoryView } from '@/components/MemoryView/MemoryView'
import { ProjectsListView } from '@/components/ProjectsListView/ProjectsListView'
import { ProjectTreePanel } from './ProjectTreePanel'
import { ProjectEditorPanel } from './ProjectEditorPanel'
import { FilesIntegration } from './FilesIntegration'
import { KeepAliveTab } from '@/components/ui/KeepAliveTab'
import { PillDropdown } from '@/components/ui/PillDropdown'
import { ProviderBanner } from './ProviderBanner'
import { getChatInputFocus } from '@/lib/chatInputRegistry'
import type { MainTab } from '@shared/types'
import { cn } from '@/lib/utils'
import {
  Blocks,
  Brain,
  CalendarClock,
  CircleDot,
  EllipsisVertical,
  LayoutDashboard,
  MessageSquare,
  Star,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// ─── Tab definitions ─────────────────────────────────────────────────
//
// In-project layout · top tabs (Chat / Tasks / Schedule / Dashboard)
// More menu    · Capabilities / Memories / Starred Artifacts
//
// Order matters — left-to-right in the tab strip mirrors the project
// detail prototype (对话 → 任务 → 计划 → 仪表盘).

type MainTabLabelKey =
  | 'mainTabs.chat'
  | 'mainTabs.issues'
  | 'mainTabs.schedule'
  | 'mainTabs.dashboard'

const tabs: { value: MainTab; labelKey: MainTabLabelKey; icon: LucideIcon }[] = [
  { value: 'chat', labelKey: 'mainTabs.chat', icon: MessageSquare },
  { value: 'issues', labelKey: 'mainTabs.issues', icon: CircleDot },
  { value: 'schedule', labelKey: 'mainTabs.schedule', icon: CalendarClock },
  { value: 'dashboard', labelKey: 'mainTabs.dashboard', icon: LayoutDashboard },
]

// ─── More Menu Item ──────────────────────────────────────────────────

interface MoreMenuItemProps {
  icon: LucideIcon
  label: string
  tab: MainTab
  activeTab: MainTab
  onSelect: (tab: MainTab) => void
}

function MoreMenuItem({ icon: Icon, label, tab, activeTab, onSelect }: MoreMenuItemProps): React.JSX.Element {
  return (
    <button
      role="menuitem"
      onClick={() => onSelect(tab)}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left',
        activeTab === tab
          ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))] font-medium'
          : 'hover:bg-[hsl(var(--foreground)/0.04)]',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </button>
  )
}

// ─── More Popover (Capabilities / Memories / Starred) ────────────────

function MorePopover(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const [open, setOpen] = useState(false)
  const activeTab = useAppStore(selectMainTab)
  const setActiveTab = useAppStore((s) => s.setMainTab)

  const handleOpenChange = useCallback((v: boolean) => setOpen(v), [])

  const handleSelect = useCallback(
    (tab: MainTab) => {
      setActiveTab(tab)
      setOpen(false)
    },
    [setActiveTab],
  )

  // Highlight trigger when any More-menu tab is active
  const isMoreTabActive =
    activeTab === 'capabilities' || activeTab === 'memories' || activeTab === 'starred'

  return (
    <PillDropdown
      open={open}
      onOpenChange={handleOpenChange}
      position="below"
      align="right"
      trigger={
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-label={t('moreOptions', { ns: 'common' })}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            'no-drag p-1.5 rounded-md transition-colors',
            open || isMoreTabActive
              ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--foreground))]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
          )}
        >
          <EllipsisVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      }
    >
      <MoreMenuItem icon={Blocks} label={t('mainTabs.capabilities')} tab="capabilities" activeTab={activeTab} onSelect={handleSelect} />
      <MoreMenuItem icon={Brain} label={t('mainTabs.memories')} tab="memories" activeTab={activeTab} onSelect={handleSelect} />
      <MoreMenuItem icon={Star} label={t('mainTabs.starredArtifacts')} tab="starred" activeTab={activeTab} onSelect={handleSelect} />
    </PillDropdown>
  )
}

// ─── Main Tab Bar ────────────────────────────────────────────────────

function MainPanelTabs(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const activeTab = useAppStore(selectMainTab)
  const setActiveTab = useAppStore((s) => s.setMainTab)

  return (
    <div
      className="drag-region shrink-0 h-12 border-b border-[hsl(var(--border)/0.5)] px-2 flex items-center justify-between"
      role="tablist"
      aria-label={t('mainPanelViews')}
    >
      {/* Left — primary tabs */}
      <div className="flex gap-1 items-center min-w-0">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                // Three-state scale aligned with the editor tabs:
                //   inactive  → transparent + muted text
                //   hover     → 0.04 ink wash (only on inactive tabs)
                //   active    → 0.08 ink wash + foreground text + medium
                // The hover class is intentionally scoped to the inactive
                // branch so hovering the active tab doesn't push it deeper
                // than necessary, and so an inactive tab's hover never
                // matches the active tab's depth.
                'no-drag px-3 py-1.5 text-sm flex items-center gap-1.5 rounded-full transition-colors',
                activeTab === tab.value
                  ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--foreground)/0.08)]'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t(tab.labelKey)}
            </button>
          )
        })}
      </div>

      {/* Right — More menu */}
      <div className="shrink-0 flex items-center">
        <MorePopover />
      </div>
    </div>
  )
}

// ─── Panel gap / splitter ────────────────────────────────────────────

/**
 * 8px-wide separator between cards. When `disabled`, it's a pure visual gap
 * (no drag affordance) — used between the locked tree and the collapsible
 * editor where dragging would be meaningless. When enabled, hovering shows
 * a 3×48 pill at the centre and dragging resizes the adjacent panels.
 */
function PanelGap({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  return (
    <Separator
      disabled={disabled}
      className={cn(
        'group/resize relative w-2 shrink-0 bg-transparent',
        disabled ? 'pointer-events-none' : 'cursor-col-resize',
      )}
    >
      {!disabled && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--border))] opacity-0 transition-opacity duration-150 group-hover/resize:opacity-60 group-data-[separator=active]/resize:bg-[hsl(var(--ring))] group-data-[separator=active]/resize:opacity-100"
        />
      )}
    </Separator>
  )
}

// ─── KeepAlive tab content ───────────────────────────────────────────

function MainContent({ activeTab }: { activeTab: MainTab }): React.JSX.Element {
  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden">
      <MainPanelTabs />

      {/* Provider not configured reminder */}
      <ProviderBanner />

      <KeepAliveTab active={activeTab === 'schedule'}>
        <ScheduleView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'dashboard'}>
        <DashboardView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'issues'}>
        <IssuesView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'chat'}>
        <ChatView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'starred'}>
        <StarredArtifactsView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'capabilities'}>
        <CapabilitiesView />
      </KeepAliveTab>
      <KeepAliveTab active={activeTab === 'memories'}>
        <MemoryView />
      </KeepAliveTab>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════
// MainPanel
//
// Layout depends on navigation state:
//
//   • projectId === null && tab !== 'schedule' → ProjectsListView
//     (gallery view replaces the in-project layout)
//
//   • projectId !== null → split: [ ProjectFilesPanel | tabs+content ]
//     The Files panel is a resizable left sidebar; the right side hosts
//     the tab strip and KeepAliveTab content.
//
//   • projectId === null && tab === 'schedule' → tabs+content only
//     (schedule has a global carve-out — reachable from search / inbox)
//
// KeepAliveTab keeps every project tab mounted so component-local state
// (scroll, drafts, etc.) survives tab switches.
// ════════════════════════════════════════════════════════════════════

/**
 * Project layout sizing constants — flat three-panel arrangement.
 *
 *   ┌─ Tree ─┬─ Editor ─┬─ Main ──────┐
 *   │ 240px  │   0 ↔ N  │  rest       │
 *   └────────┴──────────┴─────────────┘
 *
 * Tree is locked at TREE_W via min=max so the library's per-frame ResizeObserver
 * re-clamp keeps it at exactly 240px regardless of group/sibling animations.
 * Editor lives at the same nesting level as tree and main, so its flex-grow
 * animation never interacts with tree's size — eliminating the multiplicative
 * "bow" we got from nested Groups.
 */
const TREE_W = '240px' as const
/** Editor's target size when a file is open (~520px on a 1280px viewport). */
const EDITOR_OPEN_SIZE = '40%' as const

/**
 * Tabs that have their own globally-scoped view when no project is
 * selected. The default "no project" landing is the project list, but
 * these tabs explicitly carve themselves out and render their own
 * content. Add to this set when introducing future global tabs.
 */
const GLOBAL_TABS: ReadonlySet<MainTab> = new Set(['schedule', 'starred'])

export function MainPanel(): React.JSX.Element {
  const activeTab = useAppStore(selectMainTab)
  const projectId = useAppStore(selectProjectId)
  const previousTabRef = useRef<MainTab>(activeTab)
  const editorPanelRef = usePanelRef()

  // Defer enabling `layout-animated` by one frame on mount so the
  // editor panel snaps to its initial `defaultSize` without playing
  // through a 280 ms `flex-grow` transition. Without this, returning
  // to MainPanel from Inbox would briefly animate the editor expanding
  // and collapsing before settling — the library's two-tick
  // imperative resize fires after first paint and the CSS transition
  // turns the intermediate state into a visible flash.
  const [layoutAnimated, setLayoutAnimated] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setLayoutAnimated(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const showProjectsList = projectId === null && !GLOBAL_TABS.has(activeTab)
  const showFilesPanel = projectId !== null

  const project = useAppStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) ?? null : null,
  )

  // Track open-file count for the active project — drives the editor panel
  // expand/collapse animation.
  const openFilesCount = useFileStore((s) =>
    projectId ? (s.openFilesByProject[projectId]?.length ?? 0) : 0,
  )
  const editorCollapsed = useFileStore((s) =>
    projectId ? (s.editorCollapsedByProject[projectId] ?? false) : false,
  )
  // The editor pane is visible only when there are tabs to render AND
  // the user hasn't explicitly hidden it via the close-editor button.
  // Separating "no tabs" from "user-hidden" lets the close button
  // temporarily collapse the pane without losing the open-files list.
  const hasOpenFiles = openFilesCount > 0 && !editorCollapsed

  // Editor panel: programmatically resize between 0% (hidden) and the open
  // target size. Layout-animated CSS smooths the flex-grow transition. Tree
  // is locked at 240px so the editor's expansion only steals space from the
  // main panel — tree never resizes.
  //
  // `useLayoutEffect` (not `useEffect`) — the resize must commit *before*
  // paint. Otherwise on a fresh MainPanel mount (e.g. returning from the
  // Inbox tab), the panel can briefly render at a non-zero flex-grow during
  // the layout-animated transition window, making the editor flash visible
  // even with no files open. Running synchronously before paint pins the
  // size to the correct value from the first frame.
  useLayoutEffect(() => {
    const panel = editorPanelRef.current
    if (!panel) return
    panel.resize(hasOpenFiles ? EDITOR_OPEN_SIZE : '0%')
  }, [hasOpenFiles, editorPanelRef])

  useEffect(() => {
    const previousTab = previousTabRef.current
    previousTabRef.current = activeTab

    if (!(previousTab === 'issues' && activeTab === 'chat')) return

    let attempts = 0
    const maxAttempts = 8
    let rafId: number | null = null
    let cancelled = false

    const tryFocus = (): void => {
      if (cancelled) return

      const callbacks = getChatInputFocus()
      if (callbacks) {
        callbacks.focus()
        return
      }

      if (attempts >= maxAttempts) return
      attempts += 1
      rafId = requestAnimationFrame(tryFocus)
    }

    rafId = requestAnimationFrame(tryFocus)
    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [activeTab])

  if (showProjectsList) {
    // Mirror the project-detail layout: a darker "desktop" mat hosting
    // a rounded card panel. Keeps the projects list visually consistent
    // with the rest of the project workspace.
    return (
      <div className="relative h-full min-h-0 bg-[hsl(var(--muted)/0.5)] py-2 pr-2">
        <div className="h-full overflow-hidden rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border)/0.5)]">
          <ProjectsListView />
        </div>
      </div>
    )
  }

  // Global Starred — sidebar shortcut to a project-less view. Renders the
  // Starred page directly inside the same mat+card frame as the project
  // list, skipping the per-project tab bar. The tab bar makes no sense
  // here because the user isn't inside any project.
  if (projectId === null && activeTab === 'starred') {
    return (
      <div className="relative h-full min-h-0 bg-[hsl(var(--muted)/0.5)] py-2 pr-2">
        <div className="h-full overflow-hidden rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border)/0.5)]">
          <StarredArtifactsView />
        </div>
      </div>
    )
  }

  if (!showFilesPanel || !project) {
    // projectId === null && tab === 'schedule' — global schedule view, no Files panel.
    return <MainContent activeTab={activeTab} />
  }

  // Project detail layout — three sibling panels in a single Group:
  //
  //   [ Tree (locked 240px) | Editor (0% ↔ 40%) | Main (rest) ]
  //
  // Why flat instead of nested:
  //
  // Previously we had a "Files panel" (outer Panel) wrapping a nested Group
  // with tree+editor inside. Both layers animated their flex-grow on file
  // open, and the inner tree's *absolute* width = outer × tree_pct = product
  // of two linear interpolations = a quadratic curve. The user saw this as
  // the tree first widening then snapping back ("先变宽再被挤回来").
  //
  // With a single Group, the tree's flex-grow stays anchored (locked via
  // min=max=240px); the library re-clamps it on every group resize via its
  // ResizeObserver. The editor's flex-grow animates from 0% to 40% taking
  // space directly from the main panel. No nesting → no multiplication →
  // no bow. The visual is a clean rightward slide of the editor.
  return (
    <div className="relative h-full min-h-0 bg-[hsl(var(--muted)/0.5)] py-2 pr-2">
      <Group
        id="opencow-project-layout"
        orientation="horizontal"
        className={cn('h-full min-h-0', layoutAnimated && 'layout-animated')}
      >
        {/* Tree — locked at 240px. Library auto-reclamps as group resizes. */}
        <Panel
          id="project-tree"
          defaultSize={TREE_W}
          minSize={TREE_W}
          maxSize={TREE_W}
        >
          <ProjectTreePanel project={project} />
        </Panel>

        {/* Tree and editor share a single "files area" visually — no gap
            between them. When the editor is collapsed (no files), tree
            sits directly against the editor|main splitter so the visual
            gap to main stays a single 8px rather than two stacked gaps. */}

        {/* Editor — collapsible to 0%, expands to EDITOR_OPEN_SIZE on file open.
            `defaultSize` is derived from the current open-files state so a
            fresh remount (e.g. returning from Inbox) starts at the correct
            geometry without depending on a post-paint effect to correct it.
            The `useLayoutEffect` above keeps later dynamic changes in sync. */}
        <Panel
          id="project-editor"
          panelRef={editorPanelRef}
          defaultSize={hasOpenFiles ? EDITOR_OPEN_SIZE : '0%'}
          minSize="0%"
          maxSize="70%"
        >
          <ProjectEditorPanel project={project} />
        </Panel>

        <PanelGap />

        {/* Main — takes remaining space; user-draggable via the splitter. */}
        <Panel id="project-main" minSize="30%">
          <div className="h-full overflow-hidden rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border)/0.5)]">
            <MainContent activeTab={activeTab} />
          </div>
        </Panel>
      </Group>

      {/* Project-level integrations: file sync, git status, search overlay,
          ⌘F / Cmd+Z keyboard shortcuts. Co-located with the panels but
          rendered outside the Group so absolute positioning works. */}
      <FilesIntegration project={project} />
    </div>
  )
}
