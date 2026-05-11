// SPDX-License-Identifier: Apache-2.0

import { EditorTabs } from '@/components/FilesView/EditorTabs'
import { EditorPane } from '@/components/FilesView/EditorPane'
import { EditorStatusBar } from '@/components/FilesView/EditorStatusBar'
import type { Project } from '@shared/types'

/**
 * Editor-side card of the project detail layout — sibling Panel to the
 * tree panel inside MainPanel's single Group. The Panel itself is driven
 * collapsed (defaultSize='0%') and grows to a target size when files open
 * (see MainPanel for the resize logic).
 */
export function ProjectEditorPanel({ project }: { project: Project }): React.JSX.Element {
  return (
    <div className="h-full flex flex-col min-w-0 overflow-hidden rounded-xl bg-[hsl(var(--background))] border border-[hsl(var(--border)/0.5)]">
      <EditorTabs projectId={project.id} projectPath={project.path} rightSafeInset={12} />
      <div className="flex-1 min-h-0">
        <EditorPane projectPath={project.path} projectId={project.id} />
      </div>
      <EditorStatusBar projectId={project.id} projectPath={project.path} />
    </div>
  )
}
