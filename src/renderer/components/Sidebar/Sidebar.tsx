// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { cn } from '@/lib/utils'
import { Folder, MessageSquare } from 'lucide-react'
import { surfaceProps } from '@/lib/surface'
import { InboxWidget } from './InboxWidget'
import { StarredWidget } from './StarredWidget'
import { AppInfoWidget } from './AppInfoWidget'
import { SidebarUpdateCard } from './SidebarUpdateCard'

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const appView = useAppStore((s) => s.appView)
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const navigateToProject = useAppStore((s) => s.navigateToProject)
  const navigateToChatHome = useAppStore((s) => s.navigateToChatHome)
  const homeDir = useAppStore((s) => s.homeDir)
  const ensureHomeDir = useAppStore((s) => s.ensureHomeDir)

  // Resolve `$HOME` once on mount so the Chat entry can highlight when
  // the active project is rooted there.
  useEffect(() => {
    if (homeDir === null) void ensureHomeDir()
  }, [homeDir, ensureHomeDir])

  // Chat entry — active when the current project's path matches `$HOME`.
  const activeProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) ?? null
    : null
  const chatEntryActive =
    appView.mode === 'projects' &&
    homeDir !== null &&
    activeProject !== null &&
    activeProject.path === homeDir

  // "Projects" entry is active only when viewing the actual project
  // list — `projects` mode, no specific project, and the tab isn't one
  // of the globally-scoped tabs (Schedule / Starred). Those globals
  // share `projectId: null` but own their own sidebar entries, so they
  // must NOT also light up the Projects entry.
  const isProjectsActive =
    appView.mode === 'projects' &&
    appView.projectId === null &&
    appView.tab !== 'schedule' &&
    appView.tab !== 'starred'

  // Visual highlight when a specific project is open (so the user knows
  // they're inside a project even though no individual entry is shown).
  // The Chat home project owns its own entry — exclude it from the
  // generic "inside a project" highlight so both entries don't light up
  // simultaneously.
  const isInsideProject =
    appView.mode === 'projects' && selectedProjectId !== null && !chatEntryActive

  /** Single flag for "Projects entry should look active" (list view OR inside a project). */
  const projectsEntryActive = isProjectsActive || isInsideProject

  return (
    <aside
      {...surfaceProps({ elevation: 'raised', color: 'sidebar-background' })}
      className="h-full bg-[hsl(var(--sidebar-background))] flex flex-col overflow-visible"
    >
      {/* Drag region for macOS traffic lights */}
      <div className="drag-region pt-10 pb-1" />

      <nav className="flex-1 overflow-y-auto px-1.5 py-2" aria-label={t('sidebar.projectList')}>
        <div className="flex flex-col items-stretch gap-0.5">
          <button
            onClick={() => void navigateToChatHome()}
            className={cn(
              'no-drag flex flex-col items-center justify-center gap-1 py-2 rounded-md transition-colors',
              'hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
              chatEntryActive
                ? 'text-[hsl(var(--sidebar-foreground))]'
                : 'text-[hsl(var(--sidebar-foreground)/0.9)] hover:text-[hsl(var(--sidebar-foreground))]',
            )}
            aria-label={t('sidebar.chat')}
          >
            <MessageSquare
              className={cn('h-4 w-4 shrink-0', chatEntryActive && 'fill-current')}
              aria-hidden="true"
            />
            <span className="text-[10px] leading-none">{t('sidebar.chat')}</span>
          </button>
          <button
            onClick={() => navigateToProject(null)}
            className={cn(
              'no-drag flex flex-col items-center justify-center gap-1 py-2 rounded-md transition-colors',
              'hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
              projectsEntryActive
                ? 'text-[hsl(var(--sidebar-foreground))]'
                : 'text-[hsl(var(--sidebar-foreground)/0.9)] hover:text-[hsl(var(--sidebar-foreground))]',
            )}
            aria-label={t('sidebar.allProjects')}
          >
            <Folder
              // Single-path folder shape — `fill-current` fills cleanly
              // with no interior detail to preserve, so no duotone hack
              // needed for the active state.
              className={cn('h-4 w-4 shrink-0', projectsEntryActive && 'fill-current')}
              aria-hidden="true"
            />
            <span className="text-[10px] leading-none">
              {t('sidebar.allProjects')}
            </span>
          </button>
        </div>

        <div className="mt-1 space-y-0.5">
          <InboxWidget collapsed />
          {/* Short divider separating "user messages" (inbox) from
              "saved artifacts" (starred). Width matches the icon
              (h-4 w-4 = 16px); `my-1.5` lifts it off both widgets so
              it doesn't crowd the nav row above or below. */}
          <div className="flex justify-center my-1.5" aria-hidden="true">
            <div className="h-px w-4 bg-[hsl(var(--sidebar-border)/0.6)]" />
          </div>
          <StarredWidget collapsed />
          <SidebarUpdateCard collapsed />
        </div>
      </nav>

      {/* Matches the `<nav>` above's `px-1.5` so the Settings entry sits
          inset by the same 6 px on either side as the other sidebar
          menu items — otherwise its hover wash bleeds into the sidebar
          edges and visually breaks rank with the rest of the list. */}
      <div className="shrink-0 px-1.5 pb-2">
        <AppInfoWidget collapsed />
      </div>
    </aside>
  )
}
