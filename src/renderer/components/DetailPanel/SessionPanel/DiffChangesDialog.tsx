// SPDX-License-Identifier: Apache-2.0

/**
 * DiffChangesDialog — Modal dialog showing all file changes with a file tree + diff view.
 *
 * Layout: horizontal split via react-resizable-panels (Group / Panel / Separator).
 * Left panel (~30%): ChangesFileTree — fully expanded, Git-style compact paths.
 * Right panel (~70%): FileChangeDiffView — diff for the selected file.
 *
 * Includes a floating ReviewChatPanel at the bottom-right for AI-assisted code review.
 *
 * Used by:
 *   - SessionMessageList (per-turn diff button)
 *   - SessionPanel (full-session diff button)
 */
import { memo, useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, GitCompare } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Dialog } from '../../ui/Dialog'
import { ChangesFileTree, getVisualFileOrder } from './ChangesFileTree'
import { FileChangeDiffView } from './FileChangeDiffView'
import { ReviewChatPanel } from './ReviewChatPanel'
import { extractFileChanges } from './extractFileChanges'
import { isInsideEditor } from '@/lib/domUtils'
import type { ReviewContext } from './reviewTypes'
import type { ManagedSessionMessage } from '@shared/types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DiffChangesDialogProps {
  open: boolean
  onClose: () => void
  /** Messages to scan for file changes (a single turn or the entire session) */
  messages: ManagedSessionMessage[]
  /** Dialog title (e.g. "Turn Changes" or "All Session Changes") */
  title: string
  /** When provided, enables the floating review chat panel */
  reviewContext?: ReviewContext
}

// ─── Component ──────────────────────────────────────────────────────────────

export const DiffChangesDialog = memo(function DiffChangesDialog({
  open,
  onClose,
  messages,
  title,
  reviewContext,
}: DiffChangesDialogProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const changesResult = useMemo(() => extractFileChanges(messages), [messages])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const effectiveSelectedFilePath = useMemo(() => {
    if (selectedFilePath && changesResult.files.some((f) => f.filePath === selectedFilePath)) {
      return selectedFilePath
    }
    return changesResult.files[0]?.filePath ?? null
  }, [selectedFilePath, changesResult.files])

  const selectedFile = useMemo(
    () => changesResult.files.find((f) => f.filePath === effectiveSelectedFilePath) ?? null,
    [changesResult.files, effectiveSelectedFilePath],
  )

  const { stats } = changesResult

  // File paths in the same visual order as the rendered tree (dirs-first + alpha sort).
  // Used for ArrowUp / ArrowDown keyboard navigation so the selection moves in the
  // order the user actually sees, not the extraction order of changesResult.files.
  const orderedPaths = useMemo(
    () => getVisualFileOrder(changesResult.files),
    [changesResult.files],
  )

  // ── Keyboard navigation: ArrowUp / ArrowDown to switch files ─────────
  // Uses document-level listener (same pattern as useListKeyboardNav) so it
  // works regardless of which element inside the dialog currently has focus.
  // The functional updater `setSelectedFilePath(prev => ...)` avoids stale
  // closures — only `open` and `orderedPaths` need to be in the dep array.
  useEffect(() => {
    if (!open || orderedPaths.length === 0) return

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (isInsideEditor(e.target)) return

      e.preventDefault()

      setSelectedFilePath((prev) => {
        const activePath = prev && orderedPaths.includes(prev) ? prev : effectiveSelectedFilePath
        const currentIdx = activePath ? orderedPaths.indexOf(activePath) : -1
        if (e.key === 'ArrowUp') {
          return orderedPaths[currentIdx <= 0 ? orderedPaths.length - 1 : currentIdx - 1]
        }
        return orderedPaths[currentIdx >= orderedPaths.length - 1 ? 0 : currentIdx + 1]
      })
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, orderedPaths, effectiveSelectedFilePath])

  return (
    <Dialog open={open} onClose={onClose} title={title} size="4xl" className="!max-w-[90vw]">
      <div className="h-[85vh] flex flex-col rounded-2xl overflow-hidden relative">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <GitCompare className="w-4 h-4 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{title}</h3>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-[hsl(var(--muted-foreground)/0.6)] shrink-0">
              <span>{t('diffChanges.fileCount', { count: stats.totalFiles })}</span>
              {stats.createdFiles > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="text-green-400">{t('diffChanges.newFiles', { count: stats.createdFiles })}</span>
                </>
              )}
              {stats.modifiedFiles > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="text-yellow-400">{t('diffChanges.modifiedFiles', { count: stats.modifiedFiles })}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body: resizable two-panel layout */}
        {changesResult.files.length > 0 ? (
          <div className="flex-1 min-h-0">
            <Group id="diff-changes-layout" orientation="horizontal" className="min-h-0">
              {/* Left: File tree */}
              <Panel id="diff-file-tree" defaultSize="22%" minSize="15%" maxSize="45%">
                <ChangesFileTree
                  files={changesResult.files}
                  selectedFilePath={effectiveSelectedFilePath}
                  onSelectFile={setSelectedFilePath}
                />
              </Panel>

              {/* Resize handle — 1px visible line + invisible extended hit area */}
              <Separator className="w-px bg-[hsl(var(--border))] relative hover:bg-[hsl(var(--ring)/0.5)] transition-colors">
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </Separator>

              {/* Right: Diff view */}
              <Panel id="diff-content" minSize="40%">
                {selectedFile ? (
                  <FileChangeDiffView fileChange={selectedFile} />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground)/0.4)]">
                    <GitCompare className="w-8 h-8" aria-hidden="true" />
                    <p className="text-xs">{t('diffChanges.selectFile')}</p>
                  </div>
                )}
              </Panel>
            </Group>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground)/0.4)]">
            <GitCompare className="w-8 h-8" aria-hidden="true" />
            <p className="text-sm">{t('diffChanges.noChanges')}</p>
          </div>
        )}

        {/* Floating review chat — bottom-right corner */}
        {open && changesResult.files.length > 0 && reviewContext && (
          <ReviewChatPanel
            context={reviewContext}
            fileChanges={changesResult}
          />
        )}
      </div>
    </Dialog>
  )
})
