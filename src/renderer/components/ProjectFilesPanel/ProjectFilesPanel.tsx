// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { FilesViewForSelectedProject } from '@/components/FilesView/FilesView'
import { ProjectSwitcher } from './ProjectSwitcher'

/**
 * Left side panel of the project detail layout.
 *
 * Header (h-12): ProjectSwitcher (current project + dropdown to switch)
 * Body: existing FilesView (tree + editor / browser, with its own internal
 * resize between tree & editor).
 *
 * Renders nothing when no project is selected — the parent layout handles
 * the empty case (typically by collapsing the panel).
 */
export function ProjectFilesPanel(): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const project = projects.find((p) => p.id === selectedProjectId) ?? null

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        {t('sidebar.allProjects')}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-[hsl(var(--background))]">
      <header
        className="drag-region shrink-0 flex items-center px-2 border-b border-[hsl(var(--border)/0.5)]"
        style={{ height: 48 }}
      >
        <ProjectSwitcher project={project} />
      </header>
      <div className="min-h-0 flex-1">
        <FilesViewForSelectedProject />
      </div>
    </div>
  )
}
