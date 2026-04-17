// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Download, Monitor, FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { getAppAPI } from '@/windowAPI'
import { ImportDialog } from './ImportDialog'
import type { CapabilityImportSourceType } from '@shared/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEWPORT_MARGIN = 8 // px gap from viewport edges

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Self-contained "Import" popover for the Capability Center sidebar.
 *
 * Renders its own trigger button and manages open/close state internally.
 * When open, shows a dropdown menu with import sources:
 *   1. "Claude Code CLI" — discovers from ~/.claude/ + project .claude/
 *   2. "Local File" — opens native file picker, then shows ImportDialog with results
 *
 * Selecting a source closes the popover and opens ImportDialog with the
 * chosen sourceType pre-set.
 */
export function ImportPopover(): React.JSX.Element {
  const { t } = useTranslation('sessions')

  // ── Popover lifecycle ───────────────────────────────────────────────────

  const [open, setOpen] = useState(false)
  const { mounted, phase } = useModalAnimation(open)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // ── Import dialog state ─────────────────────────────────────────────────

  const [dialogOpen, setDialogOpen] = useState(false)
  const [sourceType, setSourceType] = useState<CapabilityImportSourceType>('claude-code')
  const [pendingFilePaths, setPendingFilePaths] = useState<string[] | null>(null)

  const handleSelectClaudeCode = useCallback(() => {
    setSourceType('claude-code')
    setPendingFilePaths(null)
    setOpen(false)
    setDialogOpen(true)
  }, [])

  const handleSelectFile = useCallback(async () => {
    setOpen(false) // close popover first
    const filePaths = await getAppAPI()['capability:import:pick-files']()
    if (!filePaths) return // user cancelled file picker
    setPendingFilePaths(filePaths)
    setSourceType('file')
    setDialogOpen(true)
  }, [])

  const handleDialogClose = useCallback(() => {
    setDialogOpen(false)
    setPendingFilePaths(null)
  }, [])

  // ── Viewport-aware positioning ──────────────────────────────────────────

  const [resolvedPos, setResolvedPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!mounted || !triggerRef.current || !menuRef.current) return

    const triggerRect = triggerRef.current.getBoundingClientRect()
    const { width, height } = menuRef.current.getBoundingClientRect()

    let x = triggerRect.left
    let y = triggerRect.top - height - 4 // prefer above trigger (sidebar bottom)

    // If no room above → flip below
    if (y < VIEWPORT_MARGIN) {
      y = triggerRect.bottom + 4
    }

    // Right-edge overflow → align right edge to trigger right edge
    if (x + width + VIEWPORT_MARGIN > window.innerWidth) {
      x = Math.max(VIEWPORT_MARGIN, triggerRect.right - width)
    }

    // Left-edge overflow
    if (x < VIEWPORT_MARGIN) {
      x = VIEWPORT_MARGIN
    }

    setResolvedPos({ x, y })
  }, [mounted])

  // Reset resolved position after unmount so next open recalculates.
  useEffect(() => {
    if (!mounted) setResolvedPos(null)
  }, [mounted])

  // ── Outside click + Escape ──────────────────────────────────────────────

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

  // ── Auto-focus first item ───────────────────────────────────────────────

  useEffect(() => {
    if (open && menuRef.current) {
      const firstBtn = menuRef.current.querySelector<HTMLElement>('button[role="menuitem"]')
      firstBtn?.focus()
    }
  }, [open])

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Trigger — the "Import" button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('capabilityCenter.import')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('capabilityCenter.import')}
      </button>

      {/* Dropdown menu — portal to body */}
      {mounted && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('capabilityCenter.import')}
          {...surfaceProps({ elevation: 'floating', color: 'popover' })}
          className={cn(
            'fixed z-50 w-[260px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg py-1.5 overflow-hidden',
            phase === 'enter' && 'dropdown-enter',
            phase === 'exit' && 'dropdown-exit',
          )}
          style={{
            top: resolvedPos?.y ?? -9999,
            left: resolvedPos?.x ?? -9999,
            visibility: resolvedPos ? 'visible' : 'hidden',
          }}
        >
          {/* Claude Code CLI */}
          <button
            role="menuitem"
            onClick={handleSelectClaudeCode}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] transition-colors"
          >
            <div className="p-2 rounded-lg bg-[hsl(var(--primary)/0.08)] shrink-0">
              <Monitor className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                {t('capabilityCenter.importSourceClaude')}
              </p>
              <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground)/0.7)] mt-0.5">
                {t('capabilityCenter.importSourceClaudeDesc')}
              </p>
            </div>
          </button>

          {/* Divider */}
          <div className="mx-3 my-1 border-t border-[hsl(var(--border)/0.4)]" />

          {/* Local File */}
          <button
            role="menuitem"
            onClick={handleSelectFile}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[hsl(var(--foreground)/0.04)] focus:bg-[hsl(var(--foreground)/0.04)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] transition-colors"
          >
            <div className="p-2 rounded-lg bg-[hsl(var(--muted)/0.5)] shrink-0">
              <FileUp className="h-4 w-4 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                {t('capabilityCenter.importSourceFile')}
              </p>
              <p className="text-[11px] leading-relaxed text-[hsl(var(--muted-foreground)/0.7)] mt-0.5">
                {t('capabilityCenter.importSourceFileDesc')}
              </p>
            </div>
          </button>
        </div>,
        document.body,
      )}

      {/* Import dialog — receives sourceType and optional filePaths */}
      <ImportDialog
        open={dialogOpen}
        sourceType={sourceType}
        filePaths={pendingFilePaths}
        onClose={handleDialogClose}
      />
    </>
  )
}
