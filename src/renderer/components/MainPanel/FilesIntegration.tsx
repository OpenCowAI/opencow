// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react'
import { useFileSync } from '@/hooks/useFileSync'
import { useGitStatus } from '@/hooks/useGitStatus'
import { useProjectFileOperations } from '@/hooks/useProjectFileOperations'
import { useFileStore } from '@/stores/fileStore'
import { getAppAPI } from '@/windowAPI'
import { FileSearchOverlay } from '@/components/FilesView/FileSearchOverlay'
import { createFileSearchNavigationExecutor } from '@/lib/fileSearchNavigation'
import { isInsideEditor } from '@/lib/domUtils'
import type { Project } from '@shared/types'

const EMPTY_OPEN_FILES: ReadonlyArray<{ path: string; name: string }> = []

/**
 * Project-level integrations that used to live inside FilesView:
 *   - File content sync (useFileSync)
 *   - Git status bootstrap (useGitStatus)
 *   - File search overlay (opened via ⌘F / Ctrl+F)
 *   - Cmd/Ctrl+Z to undo the latest delete
 *
 * Lives alongside the project layout panels in MainPanel so the tree and
 * editor cards can stay focused on rendering. Renders only the search
 * overlay; the hooks attach behaviour to the active project.
 */
export function FilesIntegration({ project }: { project: Project }): React.JSX.Element {
  const projectId = project.id
  const projectPath = project.path

  const openFiles = useFileStore((s) => s.openFilesByProject[projectId] ?? EMPTY_OPEN_FILES)
  const openFile = useFileStore((s) => s.openFile)
  const enqueueEditorJumpIntent = useFileStore((s) => s.enqueueEditorJumpIntent)
  const enqueueTreeRevealIntent = useFileStore((s) => s.enqueueTreeRevealIntent)
  const peekLatestDeleteUndo = useFileStore((s) => s.peekLatestDeleteUndo)

  const [searchOpen, setSearchOpen] = useState(false)
  const { undoLatestDelete } = useProjectFileOperations({ projectId, projectPath })

  const searchNavigation = useMemo(() => {
    return createFileSearchNavigationExecutor({
      project: { id: projectId, path: projectPath },
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
  }, [enqueueEditorJumpIntent, enqueueTreeRevealIntent, openFile, projectId, projectPath])

  // Sync file content (Agent writes, external edits, view switches)
  useFileSync(projectId, projectPath)
  // Bootstrap git status — subsequent updates flow via DataBus
  useGitStatus(projectPath)

  // ⌘F / Ctrl+F — toggle search overlay
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

  // Cmd/Ctrl+Z — undo most recent file delete (when not inside the editor)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'z') return
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      if (event.defaultPrevented) return
      if (isInsideEditor(event.target)) return

      const pendingUndo = peekLatestDeleteUndo(projectId)
      if (!pendingUndo) return

      event.preventDefault()
      void undoLatestDelete()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [peekLatestDeleteUndo, projectId, undoLatestDelete])

  return (
    <FileSearchOverlay
      open={searchOpen}
      projectId={projectId}
      projectPath={projectPath}
      openFiles={openFiles}
      onClose={() => setSearchOpen(false)}
      onExecuteCommand={(command) => {
        void searchNavigation.execute(command)
      }}
    />
  )
}
