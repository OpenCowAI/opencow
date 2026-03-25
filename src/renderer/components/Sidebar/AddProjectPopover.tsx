// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Plus, FolderOpen, FolderPlus, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { useAppStore } from '@/stores/appStore'

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEWPORT_MARGIN = 8 // px gap from viewport edges

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Self-contained "Add Project" popover for the sidebar.
 *
 * Renders its own trigger button (the "+" icon) and manages open/close state
 * internally.  When open, shows a lightweight dropdown menu with three actions:
 *   1. "New project…"     — requests the parent to open CreateProjectDialog
 *   2. "Browse directory…" — opens the native directory picker (existing flow)
 *   3. "Import projects…" — requests the parent to open ImportProjectsDialog
 *
 * Architecture mirrors ProjectPicker (self-contained trigger + dropdown) with
 * portal positioning from ProjectContextMenu (viewport-aware clamping).
 */
interface AddProjectPopoverProps {
  onRequestCreateProject: () => void
  onRequestImportProjects: () => void
}

export function AddProjectPopover({
  onRequestCreateProject,
  onRequestImportProjects,
}: AddProjectPopoverProps): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const addProject = useAppStore((s) => s.addProject)

  // ── Trigger & dropdown lifecycle ──────────────────────────────────────────

  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleOpenCreateDialog = useCallback(() => {
    setOpen(false) // close popover first
    onRequestCreateProject()
  }, [onRequestCreateProject])

  const handleOpenImportDialog = useCallback(() => {
    setOpen(false) // close popover first
    onRequestImportProjects()
  }, [onRequestImportProjects])

  // ── Browse directory (existing flow) ──────────────────────────────────────

  const handleBrowse = useCallback(() => {
    setOpen(false)
    addProject()
  }, [addProject])

  // ── Viewport-aware positioning (ProjectContextMenu pattern) ───────────────

  const [resolvedPos, setResolvedPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!mounted || !triggerRef.current || !menuRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const { width, height } = menuRef.current.getBoundingClientRect()

    let x = triggerRect.left
    let y = triggerRect.bottom + 4

    // Right-edge overflow → align right edge to trigger right edge
    if (x + width + VIEWPORT_MARGIN > window.innerWidth) {
      x = Math.max(VIEWPORT_MARGIN, triggerRect.right - width)
    }

    // Bottom-edge overflow → flip above trigger
    if (y + height + VIEWPORT_MARGIN > window.innerHeight) {
      y = Math.max(VIEWPORT_MARGIN, triggerRect.top - height - 4)
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- position is derived from measured DOM geometry at open time
    setResolvedPos({ x, y })
  }, [mounted])

  // Reset resolved position after unmount so next open recalculates.
  // IMPORTANT: keyed on `mounted` (not `open`) — clearing on `open=false`
  // would hide the element before the exit animation completes.
  useEffect(() => {
    if (!mounted) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear cached geometry after unmount for next open
      setResolvedPos(null)
    }
  }, [mounted])

  // ── Outside click + Escape ────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  // ── Auto-focus first item ─────────────────────────────────────────────────

  useEffect(() => {
    if (open && menuRef.current) {
      const firstBtn = menuRef.current.querySelector<HTMLElement>('button[role="menuitem"]')
      firstBtn?.focus()
    }
  }, [open])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Trigger — the "+" button */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className="no-drag flex items-center justify-center h-7 w-7 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.08)] transition-colors shrink-0"
        aria-label={t('sidebar.addProject')}
        title={t('sidebar.addProject')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Dropdown menu — portal to body */}
      {mounted && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('sidebar.addProject')}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          className={cn(
            'fixed z-50 min-w-[180px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md py-1 overflow-hidden',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          style={{
            top: resolvedPos?.y ?? -9999,
            left: resolvedPos?.x ?? -9999,
            visibility: resolvedPos ? 'visible' : 'hidden',
          }}
        >
          <button
            role="menuitem"
            onClick={handleOpenCreateDialog}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <span>{t('addProject.create', 'New project…')}</span>
          </button>

          <button
            role="menuitem"
            onClick={handleBrowse}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <span>{t('addProject.browse', 'Browse directory…')}</span>
          </button>

          <button
            role="menuitem"
            onClick={handleOpenImportDialog}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] transition-colors"
          >
            <Download className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <span>{t('addProject.import', 'Import projects…')}</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
