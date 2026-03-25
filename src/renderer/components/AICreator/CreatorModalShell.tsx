// SPDX-License-Identifier: Apache-2.0

/**
 * CreatorModalShell — Shared modal chrome for all single-panel AI Creators.
 *
 * Provides the full modal structure that Issue, Schedule, and Bot Creator
 * modals all share:
 *   - Portal to `document.body`
 *   - Backdrop with enter/exit animation
 *   - Glass-layered modal container (surface + content)
 *   - Header with icon, title, close button
 *   - Children slot for domain-specific content
 *   - Discard-confirmation dialog
 *   - Extra portals slot (for edit-form modals)
 *
 * Domain modals compose this with `useCreatorModalBehavior` (lifecycle)
 * and their domain session hook to produce a complete Creator modal.
 *
 * @module
 */

import { createPortal } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { surfaceProps } from '@/lib/surface'
import { cn } from '@/lib/utils'
import type { CreatorModalBehaviorHandle } from '@/hooks/useCreatorModalBehavior'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'

// ── Props ───────────────────────────────────────────────────────────

/** Header configuration for the modal. */
export interface CreatorModalHeader {
  /** Modal title displayed in the header. */
  title: string
  /** Accessible label for the close button. */
  closeLabel: string
}

/** i18n strings for the discard-confirmation dialog. */
export interface CreatorModalDiscardLabels {
  /** Title of the discard dialog. */
  title: string
  /** Message body of the discard dialog. */
  message: string
  /** Confirm button label. */
  confirm: string
  /** Cancel button label. */
  cancel: string
}

export interface CreatorModalShellProps {
  /** Modal behavior handle — from `useCreatorModalBehavior`. */
  modal: CreatorModalBehaviorHandle
  /** Header configuration. */
  header: CreatorModalHeader
  /** Discard dialog i18n strings. */
  discardLabels: CreatorModalDiscardLabels
  /** Main content area (session chat or empty state). */
  children: React.ReactNode
  /**
   * Extra portals rendered after the discard dialog (e.g. IssueFormModal,
   * ScheduleFormModal). These are siblings in the portal, not nested.
   */
  extraPortals?: React.ReactNode
}

// ── Component ───────────────────────────────────────────────────────

export function CreatorModalShell({
  modal,
  header,
  discardLabels,
  children,
  extraPortals
}: CreatorModalShellProps): React.JSX.Element | null {
  useBlockBrowserView('creator-modal', modal.mounted)

  if (!modal.mounted) return null

  return createPortal(
    <>
      {/* ── Full-screen container ─────────────────────────────── */}
      <div className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain no-drag">
        {/* ── Backdrop ────────────────────────────────────────── */}
        <div
          className={cn(
            'absolute inset-0 bg-black/50 surface-backdrop-isolate',
            modal.phase === 'enter' && 'modal-overlay-enter',
            modal.phase === 'exit' && 'modal-overlay-exit'
          )}
          onClick={modal.handleCloseRequest}
          aria-hidden="true"
        />

        {/* ── Modal shell — sizing & animation ────────────────── */}
        <div
          className={cn(
            'relative z-10',
            'w-[min(560px,calc(100vw-48px))] h-[min(72vh,calc(100vh-48px))]',
            modal.phase === 'enter' && 'modal-content-enter',
            modal.phase === 'exit' && 'modal-content-exit'
          )}
        >
          {/* Glass surface — child-free decorative layer */}
          <div
            {...surfaceProps({ elevation: 'modal', color: 'card' })}
            className="absolute inset-0 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl pointer-events-none"
          />

          {/* Content layer — relative, scroll-safe */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={header.title}
            className="relative flex flex-col h-full rounded-2xl outline-none overscroll-contain overflow-hidden"
          >
            {/* ── Header ──────────────────────────────────────── */}
            <div className="flex-none flex items-center gap-2 px-5 h-12 border-b border-[hsl(var(--border)/0.3)]">
              <div className="flex items-center gap-1.5 text-violet-500">
                <Sparkles className="w-3.5 h-3.5" aria-hidden />
              </div>
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {header.title}
              </span>
              <div className="flex-1" />
              <button
                onClick={modal.handleCloseRequest}
                className="p-1 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                aria-label={header.closeLabel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Main content ─────────────────────────────────── */}
            {children}
          </div>
        </div>
      </div>

      {/* ── Discard confirmation dialog ────────────────────────── */}
      <ConfirmDialog
        open={modal.showDiscardConfirm}
        title={discardLabels.title}
        message={discardLabels.message}
        confirmLabel={discardLabels.confirm}
        cancelLabel={discardLabels.cancel}
        variant="destructive"
        onConfirm={modal.handleConfirmClose}
        onCancel={modal.handleCancelClose}
      />

      {/* ── Extra portals (edit forms, etc.) ───────────────────── */}
      {extraPortals}
    </>,
    document.body
  )
}
