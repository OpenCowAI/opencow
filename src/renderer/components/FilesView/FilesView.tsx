// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useFileSync } from '@/hooks/useFileSync'
import { useGitStatus } from '@/hooks/useGitStatus'
import { useFileStore } from '@/stores/fileStore'
import { useProjectFileOperations } from '@/hooks/useProjectFileOperations'
import { FileTree } from './FileTree'
import { EditorTabs } from './EditorTabs'
import { EditorPane } from './EditorPane'
import { EditorStatusBar } from './EditorStatusBar'
import { FileBrowser } from './FileBrowser'
import { Code2, FolderOpen, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { inferDisplayModeFromFiles } from '@shared/projectTypeDetection'
import type { FilesDisplayMode } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { FileSearchOverlay } from './FileSearchOverlay'
import { createFileSearchNavigationExecutor } from '@/lib/fileSearchNavigation'
import { normalizeProjectPreferences } from '@shared/projectPreferences'
import { isInsideEditor } from '@/lib/domUtils'

const EMPTY_OPEN_FILES: ReadonlyArray<{ path: string; name: string }> = []

export interface FilesViewProjectContext {
  id: string
  name: string
  path: string
}

interface FilesViewLayoutConfig {
  /** Bottom offset (px) for the search FAB. */
  searchFabBottomOffsetPx?: number
}

interface FilesViewCoreProps {
  project: FilesViewProjectContext
  projectPreferencesSource?: {
    defaultFilesDisplayMode: import('@shared/types').ProjectPreferences['defaultFilesDisplayMode'] | null
  } | null
  layout?: FilesViewLayoutConfig
}

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
      className="inline-flex items-center gap-0.5 rounded-lg bg-[hsl(var(--background))] p-0.5"
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

function IDEMode({
  projectPath,
  projectName,
  projectId,
  modeToggleSafeInset,
  onOpenSearch,
}: {
  projectPath: string
  projectName: string
  projectId: string
  modeToggleSafeInset: number
  onOpenSearch: () => void
}): React.JSX.Element {
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
          projectId={projectId}
          onOpenSearch={onOpenSearch}
        />
      </Panel>

      <EditorResizeHandle />

      {/* Right: Editor */}
      <Panel id="file-editor" minSize="40%">
        <div className="h-full flex flex-col min-w-0">
          <EditorTabs projectId={projectId} projectPath={projectPath} rightSafeInset={modeToggleSafeInset} />
          <div className="flex-1 min-h-0">
            <EditorPane projectPath={projectPath} projectId={projectId} />
          </div>
          <EditorStatusBar projectId={projectId} projectPath={projectPath} />
        </div>
      </Panel>
    </Group>
  )
}

// === Main FilesView ===

function FilesViewCore({
  project,
  projectPreferencesSource = null,
  layout,
}: FilesViewCoreProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const projectId = project.id
  const filesDisplayModeByProject = useAppStore((s) => s.filesDisplayModeByProject)
  const setFilesDisplayMode = useAppStore((s) => s.setFilesDisplayMode)
  const openFiles = useFileStore((s) => {
    if (!projectId) return EMPTY_OPEN_FILES
    return s.openFilesByProject[projectId] ?? EMPTY_OPEN_FILES
  })
  const openFile = useFileStore((s) => s.openFile)
  const setBrowserSubPath = useFileStore((s) => s.setBrowserSubPath)
  const enqueueEditorJumpIntent = useFileStore((s) => s.enqueueEditorJumpIntent)
  const enqueueTreeRevealIntent = useFileStore((s) => s.enqueueTreeRevealIntent)
  const peekLatestDeleteUndo = useFileStore((s) => s.peekLatestDeleteUndo)
  const {
    undoLatestDelete,
  } = useProjectFileOperations({
    projectId,
    projectPath: project.path,
  })

  const mode = filesDisplayModeByProject[projectId]
  const preferredMode = projectPreferencesSource?.defaultFilesDisplayMode ?? null
  const searchFabBottomOffsetPx = layout?.searchFabBottomOffsetPx ?? 12
  const modeToggleWrapRef = useRef<HTMLDivElement>(null)
  const filesViewRootRef = useRef<HTMLDivElement>(null)
  const [modeToggleSafeInset, setModeToggleSafeInset] = useState(180)
  const [searchOpen, setSearchOpen] = useState(false)
  const [browserExternalOpenPath, setBrowserExternalOpenPath] = useState<string | null>(null)

  const searchNavigation = useMemo(() => {
    return createFileSearchNavigationExecutor({
      project: {
        id: projectId,
        path: project.path,
      },
      readers: {
        readFileContent: getAppAPI()['read-file-content'],
        readImagePreview: getAppAPI()['read-image-preview'],
      },
      writers: {
        setFilesDisplayMode,
        setBrowserSubPath,
        setBrowserExternalOpenPath,
        openFile: (request) => openFile(projectId, request),
        enqueueEditorJumpIntent,
        enqueueTreeRevealIntent,
      },
    })
  }, [
    enqueueEditorJumpIntent,
    enqueueTreeRevealIntent,
    openFile,
    projectId,
    project.path,
    setBrowserSubPath,
    setFilesDisplayMode,
  ])

  // Coordinate file content sync (Agent writes, external edits, view switches)
  useFileSync(projectId, project.path)

  // Initialise git status — cold-start IPC, subsequent updates via DataBus
  useGitStatus(project.path)

  // Auto-detect project type once (only when no cached mode exists)
  useEffect(() => {
    if (mode) return

    // Project preference comes before heuristic detection.
    if (preferredMode) {
      setFilesDisplayMode(projectId, preferredMode)
      return
    }

    let cancelled = false
    async function detect(): Promise<void> {
      try {
        const rootFiles = await getAppAPI()['list-project-files'](project.path)
        if (cancelled) return
        const detected = inferDisplayModeFromFiles(
          rootFiles.filter((f) => !f.isDirectory).map((f) => f.name)
        )
        setFilesDisplayMode(projectId, detected)
      } catch {
        if (!cancelled) setFilesDisplayMode(projectId, 'browser')
      }
    }
    detect()
    return () => { cancelled = true }
  }, [mode, preferredMode, project.path, projectId, setFilesDisplayMode])

  // Reserve space on the editor tabs row so tabs never render beneath
  // the top-right floating mode switch.
  useEffect(() => {
    const el = modeToggleWrapRef.current
    if (!el) return

    const updateSafeInset = (): void => {
      const next = Math.ceil(el.getBoundingClientRect().width) + 8
      setModeToggleSafeInset((prev) => (prev === next ? prev : next))
    }

    updateSafeInset()
    const ro = new ResizeObserver(updateSafeInset)
    ro.observe(el)
    window.addEventListener('resize', updateSafeInset)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateSafeInset)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'g') return
      if (!(e.metaKey || e.ctrlKey)) return
      if ((e as KeyboardEvent & { isComposing?: boolean }).isComposing) return
      e.preventDefault()
      setSearchOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'z') return
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.defaultPrevented) return
      if (isInsideEditor(event.target)) return

      const root = filesViewRootRef.current
      if (!root) return
      const target = event.target
      if (target instanceof Node && !root.contains(target)) return

      const pendingUndo = peekLatestDeleteUndo(projectId)
      if (!pendingUndo) return

      event.preventDefault()
      void undoLatestDelete()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [peekLatestDeleteUndo, projectId, undoLatestDelete])

  // Default to 'ide' while detection is pending
  const effectiveMode = mode ?? 'ide'

  return (
    <div ref={filesViewRootRef} className="relative h-full flex flex-col min-h-0">
      {/* Top-right header-height overlay for mode switch */}
      <div
        ref={modeToggleWrapRef}
        className="absolute top-0 right-0 z-20 h-[34px] px-3 flex items-center bg-[hsl(var(--background))]"
      >
        <ModeToggle
          mode={effectiveMode}
          onChange={(newMode) => setFilesDisplayMode(projectId, newMode)}
        />
      </div>

      {/* Mode content */}
      {effectiveMode === 'ide' ? (
        <IDEMode
          projectPath={project.path}
          projectName={project.name}
          projectId={projectId}
          modeToggleSafeInset={modeToggleSafeInset}
          onOpenSearch={() => setSearchOpen(true)}
        />
      ) : (
        <FileBrowser
          projectPath={project.path}
          projectName={project.name}
          projectId={projectId}
          onOpenSearch={() => setSearchOpen(true)}
          externalOpenPath={browserExternalOpenPath}
          onExternalOpenConsumed={() => setBrowserExternalOpenPath(null)}
        />
      )}

      <FileSearchOverlay
        open={searchOpen}
        projectId={projectId}
        projectPath={project.path}
        currentMode={effectiveMode}
        openFiles={openFiles}
        onClose={() => setSearchOpen(false)}
        onExecuteCommand={(command) => {
          if (!searchNavigation) return
          void searchNavigation.execute(command)
        }}
      />

      {!searchOpen && (
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="absolute right-3 z-30 inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-2 py-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          style={{ bottom: `${searchFabBottomOffsetPx}px` }}
          aria-label={t('search.fabAria')}
        >
          <Search className="h-3.5 w-3.5" />
          <span>{t('search.shortcutChip')}</span>
        </button>
      )}
    </div>
  )
}

export function FilesViewForSelectedProject({
  layout,
}: {
  layout?: FilesViewLayoutConfig
} = {}): React.JSX.Element {
  const { t } = useTranslation('files')
  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-[hsl(var(--muted-foreground))] text-sm">
        {t('view.selectProject')}
      </div>
    )
  }

  const normalizedPreferences = normalizeProjectPreferences(selectedProject.preferences)
  return (
    <FilesViewCore
      project={selectedProject}
      projectPreferencesSource={{ defaultFilesDisplayMode: normalizedPreferences.defaultFilesDisplayMode }}
      layout={layout}
    />
  )
}

export function FilesViewForProject({
  project,
  layout,
}: {
  project: FilesViewProjectContext
  layout?: FilesViewLayoutConfig
}): React.JSX.Element {
  return <FilesViewCore project={project} layout={layout} />
}

/**
 * Backward-compatible export used by existing tests and call sites.
 * Internally delegates to the selected-project entrypoint.
 */
export function FilesView(): React.JSX.Element {
  return <FilesViewForSelectedProject />
}
