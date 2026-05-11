// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Panel, usePanelRef } from 'react-resizable-panels'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useFileSync } from '@/hooks/useFileSync'
import { useGitStatus } from '@/hooks/useGitStatus'
import { useFileStore } from '@/stores/fileStore'
import { useProjectFileOperations } from '@/hooks/useProjectFileOperations'
import { getAppAPI } from '@/windowAPI'
import { FileTree } from './FileTree'
import { EditorTabs } from './EditorTabs'
import { EditorPane } from './EditorPane'
import { EditorStatusBar } from './EditorStatusBar'
import { FileSearchOverlay } from './FileSearchOverlay'
import { createFileSearchNavigationExecutor } from '@/lib/fileSearchNavigation'
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
  layout?: FilesViewLayoutConfig
}

// === IDE Layout (tree + editor) ===
//
// Tree is **locked** at TREE_W (240px) via min=max constraints.
//
// Why px and why locked:
//
// react-resizable-panels stores all sizes internally as percentages of the
// containing Group element. When the parent (outer Files panel) animates,
// the inner Group element resizes too — and the library has a ResizeObserver
// on the Group that re-derives the panel constraints (px → %) against the
// new groupSize on every frame. With `minSize === maxSize === '240px'`,
// each frame the library re-clamps the tree's stored % to `240/groupSize`,
// which means tree's *absolute* width stays at exactly 240px throughout the
// outer's animation. The editor naturally takes `groupSize - 240` and
// animates smoothly from 0 → ~520px.
//
// The bow we previously had (256 → 340 → 253 mid-transition) came from two
// linear flex-grow animations multiplying. With tree pinned, only the
// editor's flex-grow animates → no multiplication → no bow.
//
// Trade-off: the tree column can't be drag-resized (the library would
// re-clamp any drag back to 240px). Matches the VSCode convention of a
// fixed default-width Explorer column. The inner splitter is removed.

const TREE_W = '240px' as const

interface IDELayoutProps {
  projectPath: string
  projectName: string
  projectId: string
  /** When `false` the editor panel collapses to width 0. */
  hasOpenFiles: boolean
}

function IDELayout({
  projectPath,
  projectName,
  projectId,
  hasOpenFiles,
}: IDELayoutProps): React.JSX.Element {
  const editorPanelRef = usePanelRef()

  // Editor is the only panel that needs explicit driving: collapse to 0%
  // when no files, restore on file open. Tree is locked via min/max so the
  // library re-clamps it automatically as the outer Group animates.
  useEffect(() => {
    const panel = editorPanelRef.current
    if (!panel) return
    panel.resize(hasOpenFiles ? '100%' : '0%')
  }, [hasOpenFiles, editorPanelRef])

  // Enable layout animation only after first paint to avoid the editor
  // briefly appearing then collapsing on initial mount.
  const [layoutAnimated, setLayoutAnimated] = useState(false)
  useEffect(() => {
    let id2 = 0
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setLayoutAnimated(true))
    })
    return () => {
      cancelAnimationFrame(id1)
      cancelAnimationFrame(id2)
    }
  }, [])

  return (
    <Group
      id="files-editor-layout"
      orientation="horizontal"
      className={cn('flex-1 min-h-0', layoutAnimated && 'layout-animated')}
    >
      {/* Tree — locked at 240px (see file header for rationale). */}
      <Panel
        id="file-tree"
        defaultSize={TREE_W}
        minSize={TREE_W}
        maxSize={TREE_W}
      >
        <FileTree
          projectPath={projectPath}
          projectName={projectName}
          projectId={projectId}
        />
      </Panel>

      {/* Editor — flexible, takes whatever's left after tree's locked 240px.
          When the outer Files panel auto-grows (driven by MainPanel), the
          new space lands entirely on the editor since tree is pinned. */}
      <Panel
        id="file-editor"
        panelRef={editorPanelRef}
        defaultSize="0%"
        minSize="0%"
      >
        <div className="h-full flex flex-col min-w-0">
          <EditorTabs projectId={projectId} projectPath={projectPath} rightSafeInset={12} />
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

function FilesViewCore({ project, layout }: FilesViewCoreProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const projectId = project.id
  const openFiles = useFileStore((s) => {
    if (!projectId) return EMPTY_OPEN_FILES
    return s.openFilesByProject[projectId] ?? EMPTY_OPEN_FILES
  })
  const openFile = useFileStore((s) => s.openFile)
  const enqueueEditorJumpIntent = useFileStore((s) => s.enqueueEditorJumpIntent)
  const enqueueTreeRevealIntent = useFileStore((s) => s.enqueueTreeRevealIntent)
  const peekLatestDeleteUndo = useFileStore((s) => s.peekLatestDeleteUndo)
  const { undoLatestDelete } = useProjectFileOperations({
    projectId,
    projectPath: project.path,
  })

  const searchFabBottomOffsetPx = layout?.searchFabBottomOffsetPx ?? 12
  const filesViewRootRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)

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
  ])

  // Coordinate file content sync (Agent writes, external edits, view switches)
  useFileSync(projectId, project.path)

  // Initialise git status — cold-start IPC, subsequent updates via DataBus
  useGitStatus(project.path)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'f') return
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

  return (
    <div ref={filesViewRootRef} className="relative h-full flex flex-col min-h-0">
      <IDELayout
        projectPath={project.path}
        projectName={project.name}
        projectId={projectId}
        hasOpenFiles={openFiles.length > 0}
      />

      <FileSearchOverlay
        open={searchOpen}
        projectId={projectId}
        projectPath={project.path}
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

  return <FilesViewCore project={selectedProject} layout={layout} />
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
