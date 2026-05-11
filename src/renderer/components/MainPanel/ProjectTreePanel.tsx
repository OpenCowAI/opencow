// SPDX-License-Identifier: Apache-2.0

import { ProjectSwitcher } from '@/components/ProjectFilesPanel/ProjectSwitcher'
import { FileTree } from '@/components/FilesView/FileTree'
import type { Project } from '@shared/types'

/**
 * Tree-side card of the project detail layout.
 *
 * Header (h-12, drag-region): ProjectSwitcher.
 * Body: FileTree.
 *
 * Lives at the top level of MainPanel's flattened Group — sibling to the
 * editor and main panels rather than nested inside a "Files panel". This
 * keeps the tree's flex-grow value insulated from editor/main animation
 * (no nested-flex-grow multiplication, no apparent-width bow).
 */
export function ProjectTreePanel({ project }: { project: Project }): React.JSX.Element {
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden rounded-xl bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.5)]">
      <header
        className="drag-region shrink-0 flex items-center px-2 border-b border-[hsl(var(--border)/0.5)]"
        style={{ height: 48 }}
      >
        <ProjectSwitcher project={project} />
      </header>
      <div className="min-h-0 flex-1">
        <FileTree
          projectPath={project.path}
          projectName={project.name}
          projectId={project.id}
        />
      </div>
    </div>
  )
}
