// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X, XCircle, XSquare, Columns2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useExitAnimation } from '@/hooks/useModalAnimation'

const VIEWPORT_PADDING = 8

export interface TabContextMenuState {
  x: number
  y: number
  path: string
}

interface TabContextMenuProps {
  state: TabContextMenuState
  canCloseOthers: boolean
  canCloseToRight: boolean
  canCloseAll: boolean
  onClose: () => void
  onCloseCurrent: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseToRight: (path: string) => void
  onCloseAll: () => void
}

export function TabContextMenu({
  state,
  canCloseOthers,
  canCloseToRight,
  canCloseAll,
  onClose,
  onCloseCurrent,
  onCloseOthers,
  onCloseToRight,
  onCloseAll,
}: TabContextMenuProps): React.JSX.Element {
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
    const firstButton = menuRef.current?.querySelector<HTMLElement>('button:not(:disabled)')
    firstButton?.focus()
  }, [])

  const resolvedPos = (() => {
    const width = 210
    const height = 142
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

  const itemCls = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] disabled:opacity-45 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1'

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('editor.tabMenuAria', { defaultValue: 'Tab actions' })}
      className={cn(
        'fixed z-[70] min-w-[210px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1',
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
        className={itemCls}
        onClick={() => {
          onCloseCurrent(state.path)
          requestClose()
        }}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        {t('editor.close')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        disabled={!canCloseOthers}
        onClick={() => {
          onCloseOthers(state.path)
          requestClose()
        }}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {t('editor.closeOthers')}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        disabled={!canCloseToRight}
        onClick={() => {
          onCloseToRight(state.path)
          requestClose()
        }}
      >
        <Columns2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('editor.closeToRight')}
      </button>
      <div className="my-1 border-t border-[hsl(var(--border))]" role="separator" />
      <button
        type="button"
        role="menuitem"
        className={itemCls}
        disabled={!canCloseAll}
        onClick={() => {
          onCloseAll()
          requestClose()
        }}
      >
        <XSquare className="h-3.5 w-3.5" aria-hidden="true" />
        {t('editor.closeAll')}
      </button>
    </div>,
    document.body,
  )
}
