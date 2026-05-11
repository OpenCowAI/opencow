// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, X } from 'lucide-react'
import { useFileStore } from '@/stores/fileStore'
import { useGitStore } from '@/stores/gitStore'
import { cn } from '@/lib/utils'
import { getFileDecoration } from '@/lib/gitDecorations'
import { selectGitSnapshot } from '@/hooks/useGitStatus'
import { TabContextMenu, type TabContextMenuState } from './TabContextMenu'

interface EditorTabsProps {
  projectId: string
  projectPath: string
  /**
   * Right-side reserved space *additional* to the close-preview button.
   * Callers that float their own controls (e.g. an editor mode switch)
   * over the tab strip pass enough here so neither their control nor
   * the close-preview button overlaps the rightmost tab.
   */
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

// Close-preview affordance dimensions.  The floating button (positioned
// absolutely) and the tab strip (`paddingRight`) need to agree on how
// much space to reserve so tabs scroll *under* the button instead of
// running into it.
//
// The container is wider than the visible chip (32 vs 36) so the icon
// has comfortable horizontal whitespace on either side of the chip when
// the chip glues to the card's right edge.
const CLOSE_BUTTON_PX = 36
const CLOSE_BUTTON_FADE_PX = 24

export function EditorTabs({ projectId, projectPath, rightSafeInset = 0 }: EditorTabsProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const openFiles = useFileStore((s) => s.openFilesByProject[projectId] ?? EMPTY_OPEN_FILES)
  const activeFilePath = useFileStore((s) => s.activeFilePathByProject[projectId] ?? null)
  const setActiveFile = useFileStore((s) => s.setActiveFile)
  const closeFile = useFileStore((s) => s.closeFile)
  const closeOtherFiles = useFileStore((s) => s.closeOtherFiles)
  const closeAllFiles = useFileStore((s) => s.closeAllFiles)
  const closeFilesToRight = useFileStore((s) => s.closeFilesToRight)
  const collapseEditor = useFileStore((s) => s.collapseEditor)
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

  // Total reserved width on the right edge — the close-preview button,
  // its fade hint, plus whatever the caller asked for (e.g. an editor
  // mode switch floating above the tab strip).  The tab strip pads by
  // this much so the last tab can fully scroll into view without ending
  // up permanently hidden under the button.
  const reservedRightPx = CLOSE_BUTTON_PX + CLOSE_BUTTON_FADE_PX + rightSafeInset

  return (
    <div className="relative h-9 bg-[hsl(var(--muted)/0.2)]">
      <div
        // `no-scrollbar` keeps `overflow-x-auto`'s wheel / touch scroll
        // behaviour but hides the scrollbar chrome, matching the look of
        // editor tab strips elsewhere in the app.
        className="flex items-center h-full overflow-x-auto no-scrollbar"
        role="tablist"
        aria-label={t('editor.openFilesAria')}
        style={{ paddingRight: `${reservedRightPx}px` }}
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

      {/* Soft fade between the rightmost tab and the close-preview
          button so long tab strips don't visually crash into the button.
          Sits flush to the button's left edge; the strip's
          `paddingRight` guarantees the fade is wide enough that the last
          tab can still scroll fully into view. */}
      <div
        aria-hidden="true"
        className="absolute top-0 h-full pointer-events-none bg-gradient-to-l from-[hsl(var(--muted)/0.2)] to-transparent"
        style={{
          right: `${CLOSE_BUTTON_PX + rightSafeInset}px`,
          width: `${CLOSE_BUTTON_FADE_PX}px`,
        }}
      />

      {/* Close editor preview — collapses the entire editor pane while
          leaving open tabs intact.  Lives in absolute position with a
          *fully opaque* background that mimics the strip's effective
          color (a `--muted/0.2` tint over the editor card surface).
          Tabs scrolling past the button are completely hidden, instead
          of bleeding through a semi-transparent fill — which used to
          produce a visible "crossing" artifact when many tabs were
          open. */}
      <div
        className="absolute top-0 h-full flex items-center justify-center"
        style={{
          right: `${rightSafeInset}px`,
          width: `${CLOSE_BUTTON_PX}px`,
          // Stacked backgrounds: an opaque `--card` base layer (occludes
          // scrolling tabs) plus a `--muted/0.2` tint on top (matches
          // the strip's visual color so the button area looks like a
          // seamless extension of the strip, not a different surface).
          background:
            'linear-gradient(hsl(var(--muted) / 0.2), hsl(var(--muted) / 0.2)), hsl(var(--card))',
        }}
      >
        <button
          type="button"
          onClick={() => collapseEditor(projectId)}
          aria-label={t('editor.closeEditorPreview')}
          title={t('editor.closeEditorPreview')}
          className={cn(
            // Chip is a touch wider than the icon needs so the hit area
            // reads as a deliberate control rather than a cramped square.
            'inline-flex items-center justify-center w-7 h-6 rounded-md',
            // No own bg — inherits the container's opaque strip-color so
            // it reads as part of the strip; hover/focus adds an ink
            // wash on top of that opaque surface, same pattern as a tab
            // pill's hover.
            'text-[hsl(var(--muted-foreground))]',
            'hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]',
            'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          )}
        >
          <PanelRightClose className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

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
