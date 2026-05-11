// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useFileStore } from '@/stores/fileStore'
import { useGitStore } from '@/stores/gitStore'
import { cn } from '@/lib/utils'
import { getFileDecoration } from '@/lib/gitDecorations'
import { selectGitSnapshot } from '@/hooks/useGitStatus'
import { TabContextMenu, type TabContextMenuState } from './TabContextMenu'

interface EditorTabsProps {
  projectId: string
  projectPath: string
  /** Right-side reserved space to avoid overlap with floating mode switch. */
  rightSafeInset?: number
}

const EMPTY_OPEN_FILES: ReadonlyArray<{
  path: string
  name: string
  language: string
  content: string
  savedContent: string
  isDirty: boolean
  viewKind: 'text' | 'image'
  imageDataUrl: string | null
}> = []

export function EditorTabs({ projectId, projectPath, rightSafeInset = 0 }: EditorTabsProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const openFiles = useFileStore((s) => s.openFilesByProject[projectId] ?? EMPTY_OPEN_FILES)
  const activeFilePath = useFileStore((s) => s.activeFilePathByProject[projectId] ?? null)
  const setActiveFile = useFileStore((s) => s.setActiveFile)
  const closeFile = useFileStore((s) => s.closeFile)
  const closeOtherFiles = useFileStore((s) => s.closeOtherFiles)
  const closeAllFiles = useFileStore((s) => s.closeAllFiles)
  const closeFilesToRight = useFileStore((s) => s.closeFilesToRight)
  const gitSnapshot = useGitStore((s) => selectGitSnapshot(s, projectPath))
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null)

  const contextMeta = useMemo(() => {
    if (!contextMenu) return null
    const currentIdx = openFiles.findIndex((file) => file.path === contextMenu.path)
    if (currentIdx < 0) return null
    return {
      canCloseOthers: openFiles.length > 1,
      canCloseToRight: currentIdx < openFiles.length - 1,
      canCloseAll: openFiles.length > 0,
    }
  }, [contextMenu, openFiles])

  if (openFiles.length === 0) return <div className="h-9" />

  return (
    <div className="relative h-9 bg-[hsl(var(--muted)/0.2)]">
      <div
        // `no-scrollbar` keeps `overflow-x-auto`'s wheel / touch scroll
        // behaviour but hides the scrollbar chrome, matching the look of
        // editor tab strips elsewhere in the app.
        className="flex items-center h-full overflow-x-auto no-scrollbar"
        role="tablist"
        aria-label={t('editor.openFilesAria')}
        style={{ paddingRight: rightSafeInset > 0 ? `${rightSafeInset}px` : undefined }}
      >
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath
          const decoration = getFileDecoration(gitSnapshot, file.path)
          return (
            // Each tab is split into two layers:
            //   * outer — full-height click target, only contributes a
            //     small horizontal gap (px-0.5) between adjacent pills
            //   * inner — the actual visible pill: rounded, inset
            //     vertically (py-1) so the highlight reads as a chip
            //     rather than a full-bleed block.
            <div
              key={file.path}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              className="group flex items-center h-full px-0.5 cursor-pointer select-none shrink-0"
              onClick={() => setActiveFile(projectId, file.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  path: file.path,
                })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveFile(projectId, file.path)
              }}
              title={decoration.tooltip ?? undefined}
            >
              <span
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] transition-colors',
                  isActive
                    // "Pressed" pill — a subtle ink wash sitting *deeper*
                    // than the strip so the active tab reads as the
                    // selected chip rather than a bright cut-out.
                    ? 'bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] group-hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
              >
                {file.isDirty && (
                  <span
                    className="w-2 h-2 rounded-full bg-[hsl(var(--foreground))] shrink-0"
                    aria-label={t('editor.unsavedChanges')}
                  />
                )}
                <span className={cn('truncate max-w-[160px]', decoration.colorClass)}>
                  {file.name}
                </span>
                {decoration.badge && (
                  <span className={cn('text-[10px] font-mono shrink-0', decoration.colorClass)}>
                    {decoration.badge}
                  </span>
                )}
                <button
                  className={cn(
                    'p-0.5 rounded shrink-0 transition-opacity hover:bg-[hsl(var(--foreground)/0.06)]',
                    // Keep the button in the layout (opacity, not display)
                    // so the pill width stays constant whether or not the
                    // user is hovering. `focus-within` ensures keyboard
                    // focus also reveals the button.
                    'opacity-0 pointer-events-none',
                    'group-hover:opacity-100 group-hover:pointer-events-auto',
                    'group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeFile(projectId, file.path)
                  }}
                  aria-label={t('editor.closeFile', { name: file.name })}
                  tabIndex={-1}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )
        })}
      </div>
      {rightSafeInset > 0 && (
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 h-full pointer-events-none bg-gradient-to-l from-[hsl(var(--muted)/0.2)] to-transparent"
          style={{ width: `${Math.max(16, rightSafeInset)}px` }}
        />
      )}
      {contextMenu && contextMeta && (
        <TabContextMenu
          state={contextMenu}
          canCloseOthers={contextMeta.canCloseOthers}
          canCloseToRight={contextMeta.canCloseToRight}
          canCloseAll={contextMeta.canCloseAll}
          onClose={() => setContextMenu(null)}
          onCloseCurrent={(path) => closeFile(projectId, path)}
          onCloseOthers={(path) => closeOtherFiles(projectId, path)}
          onCloseToRight={(path) => closeFilesToRight(projectId, path)}
          onCloseAll={() => closeAllFiles(projectId)}
        />
      )}
    </div>
  )
}
