// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useFileSync } from '@/hooks/useFileSync'
import { useGitStatus } from '@/hooks/useGitStatus'
import { FileTree } from './FileTree'
import { EditorTabs } from './EditorTabs'
import { EditorPane } from './EditorPane'
import { EditorStatusBar } from './EditorStatusBar'
import { FileBrowser } from './FileBrowser'
import { Code2, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inferDisplayModeFromFiles } from '@shared/projectTypeDetection'
import type { FilesDisplayMode } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// === Mode Toggle Button ===

function ModeToggle({
  mode,
  onChange
}: {
  mode: FilesDisplayMode
  onChange: (mode: FilesDisplayMode) => void
}): React.JSX.Element {
  const { t } = useTranslation('files')
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg bg-[hsl(var(--muted)/0.35)] p-0.5"
      role="radiogroup"
      aria-label={t('view.modeSwitchAria')}
    >
      <button
        type="button"
        onClick={() => onChange('ide')}
        role="radio"
        aria-checked={mode === 'ide'}
        title={t('view.editorTab')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          mode === 'ide'
            ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
            : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]'
        )}
        aria-label={t('view.editorMode')}
      >
        <Code2 className="h-3.5 w-3.5" />
        <span>{t('view.editorTab')}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('browser')}
        role="radio"
        aria-checked={mode === 'browser'}
        title={t('view.browserTab')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          mode === 'browser'
            ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
            : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.04)] hover:text-[hsl(var(--foreground))]'
        )}
        aria-label={t('view.browserMode')}
      >
        <FolderOpen className="h-3.5 w-3.5" />
        <span>{t('view.browserTab')}</span>
      </button>
    </div>
  )
}

// === IDE Mode (existing layout) ===

function EditorResizeHandle(): React.JSX.Element {
  return (
    <Separator
      className="w-px bg-[hsl(var(--border)/0.5)] relative data-[state=drag]:bg-[hsl(var(--ring))] hover:bg-[hsl(var(--ring)/0.5)] transition-colors"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </Separator>
  )
}

function IDEMode({ projectPath, projectName }: { projectPath: string; projectName: string }): React.JSX.Element {
  return (
    <Group
      id="files-editor-layout"
      orientation="horizontal"
      className="flex-1 min-h-0"
    >
      {/* Left: Directory Tree */}
      <Panel
        id="file-tree"
        defaultSize="25%"
        minSize="15%"
        maxSize="40%"
      >
        <FileTree
          projectPath={projectPath}
          projectName={projectName}
        />
      </Panel>

      <EditorResizeHandle />

      {/* Right: Editor */}
      <Panel id="file-editor" minSize="40%">
        <div className="h-full flex flex-col min-w-0">
          <EditorTabs projectPath={projectPath} />
          <div className="flex-1 min-h-0">
            <EditorPane projectPath={projectPath} />
          </div>
          <EditorStatusBar projectPath={projectPath} />
        </div>
      </Panel>
    </Group>
  )
}

// === Main FilesView ===

export function FilesView(): React.JSX.Element {
  const { t } = useTranslation('files')
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const filesDisplayModeByProject = useAppStore((s) => s.filesDisplayModeByProject)
  const setFilesDisplayMode = useAppStore((s) => s.setFilesDisplayMode)

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const projectId = selectedProject?.id
  const mode = projectId ? filesDisplayModeByProject[projectId] : undefined

  // Coordinate file content sync (Agent writes, external edits, view switches)
  useFileSync(selectedProject?.path)

  // Initialise git status — cold-start IPC, subsequent updates via DataBus
  useGitStatus(selectedProject?.path)

  // Auto-detect project type once (only when no cached mode exists)
  useEffect(() => {
    if (!selectedProject || !projectId || mode) return

    let cancelled = false
    async function detect(): Promise<void> {
      try {
        const rootFiles = await getAppAPI()['list-project-files'](selectedProject!.path)
        if (cancelled) return
        const detected = inferDisplayModeFromFiles(
          rootFiles.filter((f) => !f.isDirectory).map((f) => f.name)
        )
        setFilesDisplayMode(projectId!, detected)
      } catch {
        if (!cancelled) setFilesDisplayMode(projectId!, 'browser')
      }
    }
    detect()
    return () => { cancelled = true }
  }, [projectId, mode, selectedProject, setFilesDisplayMode])

  if (!selectedProject || !projectId) {
    return (
      <div className="h-full flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">
        {t('view.selectProject')}
      </div>
    )
  }

  // Default to 'ide' while detection is pending
  const effectiveMode = mode ?? 'ide'

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-[hsl(var(--border)/0.4)] shrink-0">
        <ModeToggle
          mode={effectiveMode}
          onChange={(newMode) => setFilesDisplayMode(projectId, newMode)}
        />
      </div>

      {/* Mode content */}
      {effectiveMode === 'ide' ? (
        <IDEMode projectPath={selectedProject.path} projectName={selectedProject.name} />
      ) : (
        <FileBrowser projectPath={selectedProject.path} projectName={selectedProject.name} projectId={projectId} />
      )}
    </div>
  )
}
