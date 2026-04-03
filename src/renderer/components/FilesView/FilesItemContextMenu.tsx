// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FilePlus2, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useExitAnimation } from '@/hooks/useModalAnimation'

const VIEWPORT_PADDING = 8

export interface FilesItemContextMenuState {
  x: number
  y: number
  path: string
  name: string
  isDirectory: boolean
  /** `directory` means background context (new item actions only). */
  scope?: 'entry' | 'directory'
}

interface FilesItemContextMenuProps {
  state: FilesItemContextMenuState
  onClose: () => void
  onCreateFile: (path: string, isDirectory: boolean) => void
  onCreateFolder: (path: string, isDirectory: boolean) => void
  onRename: (path: string) => void
  onDelete: (path: string, isDirectory: boolean, name: string) => void
}

export function FilesItemContextMenu({
  state,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}: FilesItemContextMenuProps): React.JSX.Element {
  const { t } = useTranslation('files')
  const { phase, requestClose } = useExitAnimation(onClose)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) {
        requestClose()
      }
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [requestClose])

  useEffect(() => {
    const firstButton = menuRef.current?.querySelector('button')
    firstButton?.focus()
  }, [])

  const resolvedPos = (() => {
    const width = 180
    const height = state.scope === 'directory' ? 88 : 160
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = state.x
    let y = state.y
    if (x + width > vw - VIEWPORT_PADDING) {
      x = Math.max(VIEWPORT_PADDING, vw - width - VIEWPORT_PADDING)
    }
    if (y + height > vh - VIEWPORT_PADDING) {
      y = Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING)
    }
    return { x, y }
  })()

  const renameLabel = state.isDirectory
    ? t('actions.renameFolder')
    : t('actions.renameFile')
  const deleteLabel = state.isDirectory
    ? t('actions.deleteFolder')
    : t('actions.deleteFile')
  const isEntryScope = state.scope !== 'directory'

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('actions.itemMenuAria', { defaultValue: 'File actions' })}
      className={cn(
        'fixed z-[70] min-w-[180px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1',
        phase === 'enter' && 'dropdown-enter',
        phase === 'exit' && 'dropdown-exit',
      )}
      style={{
        top: resolvedPos.y,
        left: resolvedPos.x,
      }}
    >
      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
        onClick={() => {
          onCreateFile(state.path, state.isDirectory)
          requestClose()
        }}
      >
        <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('actions.newFile')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
        onClick={() => {
          onCreateFolder(state.path, state.isDirectory)
          requestClose()
        }}
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('actions.newFolder')}
      </button>
      {isEntryScope && (
        <>
          <div className="my-1 border-t border-[hsl(var(--border))]" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
            onClick={() => {
              onRename(state.path)
              requestClose()
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {renameLabel}
          </button>
          <div className="my-1 border-t border-[hsl(var(--border))]" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/8 focus:bg-red-500/8 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
            onClick={() => {
              onDelete(state.path, state.isDirectory, state.name)
              requestClose()
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {deleteLabel}
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
