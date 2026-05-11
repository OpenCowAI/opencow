// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Folder } from 'lucide-react'
import { useAppStore } from '@/stores/appStore'
import { ProjectSwitcher } from '@/components/ProjectFilesPanel/ProjectSwitcher'
import { FileTree } from '@/components/FilesView/FileTree'
import type { Project } from '@shared/types'

/**
 * Tree-side card of the project detail layout.
 *
 * Header (h-12, drag-region): ProjectSwitcher — or, when the current
 * project is the Chat home project (path === `$HOME`), a static "Files"
 * label. Chat is an entry-point shortcut, not a way to browse projects,
 * so exposing the switcher inside it would invite users to "switch into
 * Chat from Chat" which has no meaning. The label reads "Files" (not
 * "Chat") because the panel actually shows the file tree — the header
 * should describe its content, not duplicate the sidebar entry's label.
 *
 * Body: FileTree.
 *
 * Lives at the top level of MainPanel's flattened Group — sibling to the
 * editor and main panels rather than nested inside a "Files panel". This
 * keeps the tree's flex-grow value insulated from editor/main animation
 * (no nested-flex-grow multiplication, no apparent-width bow).
 */
export function ProjectTreePanel({ project }: { project: Project }): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const homeDir = useAppStore((s) => s.homeDir)
  const isChatHome = homeDir !== null && project.path === homeDir

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden rounded-xl bg-[hsl(var(--card))] border border-[hsl(var(--border)/0.5)]">
      <header
        className="drag-region shrink-0 flex items-center px-2 border-b border-[hsl(var(--border)/0.5)]"
        style={{ height: 48 }}
      >
        {isChatHome ? (
          // Static label — visual structure mirrors `ProjectSwitcher`'s
          // trigger so the header height / paddings stay identical.
          <div className="no-drag flex min-w-0 max-w-full flex-1 items-center gap-2 rounded-lg p-1.5">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
              <Folder className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[hsl(var(--foreground))]">
              {t('mainTabs.files')}
            </span>
          </div>
        ) : (
          <ProjectSwitcher project={project} />
        )}
      </header>
      <div className="min-h-0 flex-1">
        <FileTree
          projectPath={project.path}
          projectName={project.name}
          projectId={project.id}
          // The Chat home project is rooted at `$HOME` — dotfiles would
          // dominate that view. Hide them; other projects keep the
          // default visibility because dotfiles are meaningful there.
          hideDotFiles={isChatHome}
        />
      </div>
    </div>
  )
}
