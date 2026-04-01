// SPDX-License-Identifier: Apache-2.0

import { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Pin, Archive, Trash2, Pencil, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/appStore'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import type { Project, ProjectGroup } from '@shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProjectContextMenuState {
  position: { x: number; y: number }
  /** The project on which the context menu was invoked. */
  project: Project
  /** The display group the project currently belongs to (affects available actions). */
  group: ProjectGroup
}

interface ProjectContextMenuProps {
  state: ProjectContextMenuState
  onClose: () => void
  /** Invoked with the project ID when the user selects "Rename". */
  onRenameRequest: (projectId: string) => void
  /** Invoked with the full Project object when the user selects "Remove". */
  onDeleteRequest: (project: Project) => void
  /** Invoked with the project ID when the user selects "Project Settings". */
  onSettingsRequest: (projectId: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Right-click context menu for a project in the sidebar.
 *
 * Owns pin/archive/remove action dispatch. The remove action delegates to
 * the parent via `onDeleteRequest` so the confirmation flow stays in one place.
 */
export function ProjectContextMenu({
  state,
  onClose,
  onRenameRequest,
  onDeleteRequest,
  onSettingsRequest,
}: ProjectContextMenuProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const pinProject = useAppStore((s) => s.pinProject)
  const unpinProject = useAppStore((s) => s.unpinProject)
  const archiveProject = useAppStore((s) => s.archiveProject)
  const unarchiveProject = useAppStore((s) => s.unarchiveProject)
  const menuRef = useRef<HTMLDivElement>(null)
  const { phase, requestClose } = useExitAnimation(onClose)

  // Close on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [requestClose])

  // Auto-focus first item for keyboard accessibility
  useEffect(() => {
    const firstBtn = menuRef.current?.querySelector('button')
    firstBtn?.focus()
  }, [])

  // ── Viewport-aware position clamping ────────────────────────────────────
  // Render invisible on first pass, measure actual menu dimensions, then snap
  // into viewport before the browser paints (no visible flash).
  const [resolvedPos, setResolvedPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return

    const { width, height } = el.getBoundingClientRect()
    const MARGIN = 8 // px gap from viewport edges
    const vw = window.innerWidth
    const vh = window.innerHeight

    let x = state.position.x
    let y = state.position.y

    // If menu would overflow the right edge, flip it to open leftward
    if (x + width + MARGIN > vw) {
      x = Math.max(MARGIN, x - width)
    }

    // If menu would overflow the bottom edge, shift it upward
    if (y + height + MARGIN > vh) {
      y = Math.max(MARGIN, vh - height - MARGIN)
    }

    setResolvedPos({ x, y })
  }, [state.position])

  const isPinned = state.group === 'pinned'
  const isArchived = state.group === 'archived'
  const { project } = state

  const handlePin = async (): Promise<void> => {
    if (isPinned) {
      await unpinProject(project.id)
    } else {
      await pinProject(project.id)
    }
    requestClose()
  }

  const handleArchive = async (): Promise<void> => {
    if (isArchived) {
      await unarchiveProject(project.id)
    } else {
      await archiveProject(project.id)
    }
    requestClose()
  }

  const handleRename = (): void => {
    onRenameRequest(project.id)
    requestClose()
  }

  const handleSettings = (): void => {
    onSettingsRequest(project.id)
    requestClose()
  }

  const handleDeleteClick = (): void => {
    onDeleteRequest(project)
    requestClose()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('projectActions.actions')}
      className={cn(
        'fixed z-50 min-w-[160px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1',
        phase === 'enter' && 'dropdown-enter',
        phase === 'exit' && 'dropdown-exit',
      )}
      style={{
        top: resolvedPos?.y ?? state.position.y,
        left: resolvedPos?.x ?? state.position.x,
        // Hide until viewport-clamped position is calculated to avoid a
        // one-frame flash of the menu at the wrong location.
        visibility: resolvedPos ? 'visible' : 'hidden',
      }}
    >
      <button
        role="menuitem"
        onClick={handlePin}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        <Pin className="h-3.5 w-3.5" aria-hidden="true" />
        {isPinned ? t('projectActions.unpin') : t('projectActions.pinToTop')}
      </button>
      <button
        role="menuitem"
        onClick={handleArchive}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        <Archive className="h-3.5 w-3.5" aria-hidden="true" />
        {isArchived ? t('projectActions.unarchive') : t('projectActions.archive')}
      </button>
      <button
        role="menuitem"
        onClick={handleRename}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        {t('projectActions.rename')}
      </button>
      <button
        role="menuitem"
        onClick={handleSettings}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        {t('projectActions.settings')}
      </button>
      <div className="my-1 border-t border-[hsl(var(--border))]" role="separator" />
      <button
        role="menuitem"
        onClick={handleDeleteClick}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/8 focus:bg-red-500/8 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        {t('projectActions.remove')}
      </button>
    </div>,
    document.body,
  )
}
