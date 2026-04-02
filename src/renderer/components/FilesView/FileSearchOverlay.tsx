// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, FileText, FolderOpen, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFilesQuickSearch, type FilesQuickSearchItem } from '@/hooks/useFilesQuickSearch'
import { useFileStore } from '@/stores/fileStore'
import { parseFileSearchQuery } from '@/lib/fileSearchQuery'
import type { FilesDisplayMode } from '@shared/types'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import {
  buildFileSearchNavigationCommand,
  resolveFileSearchActionLabels,
  type FileSearchActionLabelToken,
  type FileSearchNavigationCommand,
} from '@/lib/fileSearchNavigation'

interface FileSearchOverlayProps {
  open: boolean
  projectId: string
  projectPath: string
  currentMode: FilesDisplayMode
  openFiles: readonly { path: string; name: string }[]
  onClose: () => void
  onExecuteCommand: (command: FileSearchNavigationCommand) => void
}

interface HighlightPart {
  text: string
  highlighted: boolean
}

function splitHighlightRuns(text: string, indices: readonly number[]): HighlightPart[] {
  if (indices.length === 0) return [{ text, highlighted: false }]
  const set = new Set(indices)
  const out: HighlightPart[] = []
  let start = 0
  while (start < text.length) {
    const hl = set.has(start)
    let end = start + 1
    while (end < text.length && set.has(end) === hl) end += 1
    out.push({ text: text.slice(start, end), highlighted: hl })
    start = end
  }
  return out
}

export function FileSearchOverlay({
  open,
  projectId,
  projectPath,
  currentMode,
  openFiles,
  onClose,
  onExecuteCommand,
}: FileSearchOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation('files')
  const { mounted, phase } = useModalAnimation(open)
  const queryInStore = useFileStore((s) => s.fileSearchQueryByProject[projectId] ?? '')
  const setQueryInStore = useFileStore((s) => s.setFileSearchQuery)
  const recordFileSearchSelection = useFileStore((s) => s.recordFileSearchSelection)

  const [queryInput, setQueryInput] = useState(queryInStore)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const parsed = useMemo(() => parseFileSearchQuery(queryInput), [queryInput])

  const { items, loading } = useFilesQuickSearch({
    projectId,
    projectPath,
    openFiles,
    query: parsed.searchText,
    isOpen: open,
  })

  useEffect(() => {
    if (!open) return
    setQueryInput(queryInStore)
    setSelectedIndex(0)
    const rafId = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(rafId)
    // Intentionally exclude queryInStore from deps: when overlay is open,
    // query updates are driven by local input state; re-running this effect
    // on every store write would re-select input text on each keystroke.
  }, [open, projectId])

  useEffect(() => {
    if (!open) return
    setQueryInStore(projectId, queryInput)
  }, [open, projectId, queryInput, setQueryInStore])

  useEffect(() => {
    if (selectedIndex < items.length) return
    setSelectedIndex(Math.max(0, items.length - 1))
  }, [items.length, selectedIndex])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-file-search-index="${selectedIndex}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  if (!mounted) return null

  const activeItem = items[selectedIndex] ?? null
  const actionLabels = resolveFileSearchActionLabels(activeItem, currentMode)

  const closeAndReset = (): void => {
    onClose()
  }

  const actionLabelText = (token: FileSearchActionLabelToken): string => {
    if (token === 'open') return t('searchOverlay.actions.open')
    if (token === 'openFolder') return t('searchOverlay.actions.openFolder')
    if (token === 'revealInTree') return t('searchOverlay.actions.revealInTree')
    if (token === 'openInEditor') return t('searchOverlay.actions.openInEditor')
    if (token === 'revealParent') return t('searchOverlay.actions.revealParent')
    return t('searchOverlay.actions.reveal')
  }

  const activateCurrent = (action: 'current' | 'editor' | 'reveal'): void => {
    if (!activeItem) return
    recordFileSearchSelection(projectId, {
      path: activeItem.path,
      name: activeItem.name,
      kind: activeItem.isDirectory ? 'directory' : 'file',
    })
    onExecuteCommand(
      buildFileSearchNavigationCommand({
        action,
        target: {
          path: activeItem.path,
          name: activeItem.name,
          isDirectory: activeItem.isDirectory,
        },
        mode: currentMode,
        line: parsed.line,
      }),
    )
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if ((e.nativeEvent as KeyboardEvent & { isComposing?: boolean }).isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeAndReset()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((idx) => Math.min(items.length - 1, idx + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((idx) => Math.max(0, idx - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.altKey) {
        activateCurrent('reveal')
      } else if (e.metaKey || e.ctrlKey) {
        activateCurrent('editor')
      } else {
        activateCurrent('current')
      }
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center pt-16 no-drag">
      <div
        className={cn(
          'absolute inset-0 bg-black/40',
          phase === 'enter' && 'modal-overlay-enter',
          phase === 'exit' && 'modal-overlay-exit',
        )}
        onClick={closeAndReset}
        aria-hidden="true"
      />
      <div
        className={cn(
          'relative z-10 w-[min(760px,calc(100%-32px))] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-2xl overflow-hidden',
          phase === 'enter' && 'modal-content-enter',
          phase === 'exit' && 'modal-content-exit',
        )}
        role="dialog"
        aria-modal="true"
        aria-label={t('searchOverlay.dialogAria')}
      >
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 h-11">
          <Search className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <input
            ref={inputRef}
            type="text"
            value={queryInput}
            onChange={(e) => {
              setQueryInput(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={onKeyDown}
            className="h-full flex-1 bg-transparent outline-none text-sm"
            placeholder={t('searchOverlay.searchPlaceholder')}
            aria-label={t('searchOverlay.searchInputAria')}
          />
          {parsed.line != null && (
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{t('searchOverlay.lineIndicator', { line: parsed.line })}</span>
          )}
        </div>

        <div
          ref={listRef}
          className="max-h-[min(62vh,520px)] overflow-y-auto p-2"
          role="listbox"
          aria-label={t('searchOverlay.resultsAria')}
        >
          {loading ? (
            <p className="px-2 py-6 text-sm text-[hsl(var(--muted-foreground))] text-center">{t('searchOverlay.searching')}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-6 text-sm text-[hsl(var(--muted-foreground))] text-center">{t('searchOverlay.emptyResults')}</p>
          ) : (
            items.map((item, idx) => {
              const nameParts = splitHighlightRuns(item.name, item.nameHighlights)
              const pathParts = splitHighlightRuns(item.path, item.pathHighlights)
              const selected = idx === selectedIndex

              return (
                <button
                  key={`${item.source}:${item.path}`}
                  type="button"
                  data-file-search-index={idx}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    setSelectedIndex(idx)
                    activateCurrent('current')
                  }}
                  className={cn(
                    'w-full text-left rounded-md px-2.5 py-2 flex items-start gap-2.5 transition-colors',
                    selected
                      ? 'bg-[hsl(var(--primary)/0.14)]'
                      : 'hover:bg-[hsl(var(--foreground)/0.05)]',
                  )}
                  role="option"
                  aria-selected={selected}
                >
                  {item.isDirectory ? (
                    <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  ) : (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[hsl(var(--foreground))]">
                      {nameParts.map((part, partIdx) => (
                        <span
                          key={`n-${partIdx}`}
                          className={part.highlighted ? 'font-semibold text-[hsl(var(--foreground))]' : undefined}
                        >
                          {part.text}
                        </span>
                      ))}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--muted-foreground))] font-mono">
                      {pathParts.map((part, partIdx) => (
                        <span
                          key={`p-${partIdx}`}
                          className={part.highlighted ? 'text-[hsl(var(--foreground))]' : undefined}
                        >
                          {part.text}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                    {item.source}
                  </span>
                </button>
              )
            })
          )}
        </div>

        <div className="border-t border-[hsl(var(--border))] px-3 py-1.5 text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-3">
          <span>{t('searchOverlay.shortcuts.navigate')}</span>
          <span>
            <CornerDownLeft className="inline h-3 w-3 mr-1" />{actionLabelText(actionLabels.current)}
          </span>
          <span>{t('searchOverlay.shortcuts.editorPrefix')} {actionLabelText(actionLabels.editor)}</span>
          <span>{t('searchOverlay.shortcuts.revealPrefix')} {actionLabelText(actionLabels.reveal)}</span>
          <span className="ml-auto">{t('searchOverlay.shortcuts.close')}</span>
        </div>
      </div>
    </div>
  )
}
