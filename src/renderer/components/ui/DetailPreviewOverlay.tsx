// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useExitAnimation } from '@/hooks/useModalAnimation'

// ─── DetailPreviewOverlay ───────────────────────────────────────────────────

interface DetailPreviewOverlayProps {
  /** Fired after the exit animation completes; tear down the overlay here. */
  onClose: () => void
  /**
   * Modal behavior toggle.
   *
   * - `true` (default): a transparent full-viewport hit area is rendered
   *   behind the panel; clicking it closes the panel.  Used when the
   *   surface underneath is a passive backdrop (e.g. Starred-artifacts
   *   list).
   *
   * - `false`: no hit area — only the right-edge panel itself is rendered.
   *   The rest of the UI stays interactive, so the user can pick another
   *   list row to swap the panel content without first closing.
   *   Combined with `swapTargetSelector`, selective dismiss-on-click
   *   keeps "click another row → swap" and "click elsewhere → close"
   *   both working.
   */
  modal?: boolean
  /** `aria-label` for the panel — required for screen-reader accessibility. */
  ariaLabel: string
  /**
   * CSS selector identifying click targets in the underlying surface that
   * should NOT dismiss the overlay.  Typically the list's row wrapper
   * (`[data-issue-row]`, `[data-schedule-row]`).  When omitted, every
   * non-modal click outside the panel dismisses.
   *
   * Only used in non-modal mode.
   */
  swapTargetSelector?: string
  /**
   * Render-prop for the panel body.  Receives `requestClose`, a closer
   * that plays the exit animation before invoking `onClose` — wire it to
   * the inner X / Cancel buttons so they animate consistently with
   * outside-click and ESC.
   */
  children: (requestClose: () => void) => ReactNode
}

/**
 * Right-aligned floating side-panel used for non-disruptive detail
 * previews (issue detail, schedule detail, …).  Lifts the cross-cutting
 * concerns — portal mount, enter/exit animation, selective
 * outside-click dismissal, ESC binding — out of the consumers so each
 * detail view stays a pure renderer of its own data shape.
 *
 * Selective dismiss policy (non-modal mode):
 *   - Inside the panel itself          → keep open
 *   - On a `swapTargetSelector` match  → keep open; the row's own
 *                                        onClick will swap the panel
 *   - Inside any floating UI surface   → keep open (context menus,
 *     (`[data-surface="modal"]`,         dropdowns, dialogs the user
 *      `[role="menu" | "dialog" |        opened from the panel or list)
 *      "listbox" | "alertdialog"]`)
 *   - Any *other* modal layer mounted  → keep open.  Backdrop clicks on
 *     above the panel                    a nested Dialog escape the
 *                                        ancestor walk (Dialog's outer
 *                                        wrapper isn't tagged), so a
 *                                        global probe is the last line
 *                                        of defense.
 *   - Anywhere else                    → close
 */
export const DetailPreviewOverlay = memo(function DetailPreviewOverlay({
  onClose,
  modal = true,
  ariaLabel,
  swapTargetSelector,
  children,
}: DetailPreviewOverlayProps): React.JSX.Element {
  const { phase, requestClose } = useExitAnimation(onClose)
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus the panel on mount so the panel-level ESC handler — or any
  // future panel-scoped shortcuts — work without an explicit click.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // ESC to close.  Document-level rather than panel-onKeyDown so the
  // shortcut works after focus has drifted off the panel onto a list
  // row (typical in non-modal mode).
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        requestClose()
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [requestClose])

  // Non-modal selective outside-click dismissal.  See class-level
  // doc-comment for the full policy.  Uses `mousedown` (not `click`) so
  // the exit animation starts the moment the user commits to an outside
  // click, before a subsequent `click` handler can move focus or trigger
  // scroll thrash.
  useEffect(() => {
    if (modal) return
    // `data-surface="modal"` covers `<Dialog>` / `<ConfirmDialog>` etc.
    // `data-surface="floating"` covers popovers / dropdowns / tooltips
    // (PillDropdown, StopButtonPopover, ProjectPicker, ChatHeader's
    // session menu, etc.) — anything the user *deliberately opened*
    // from the panel content.  Without floating in the safe-zone list,
    // clicking a button inside e.g. the stop-session confirmation
    // dropdown was being treated as an outside click and dismissing
    // the panel underneath.
    const MODAL_SELECTOR =
      '[data-surface="modal"], [data-surface="floating"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      const panel = panelRef.current
      if (panel?.contains(target)) return
      if (swapTargetSelector && target.closest(swapTargetSelector)) return
      if (target.closest(MODAL_SELECTOR)) return

      // Global modal probe — catches Dialog backdrop clicks whose
      // target isn't itself inside any marker element.
      const modals = document.querySelectorAll(MODAL_SELECTOR)
      for (const m of modals) {
        if (m !== panel && !panel?.contains(m)) return
      }

      requestClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [modal, requestClose, swapTargetSelector])

  const handleOutsideClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) requestClose()
    },
    [requestClose],
  )

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      {...surfaceProps({ elevation: 'modal', color: 'card' })}
      className={cn(
        // Top/right insets match MainPanel's `py-2 pr-2` mat so the
        // popover lines up visually with the underlying card.
        //
        // `z-[150]` puts the panel above the MainPanel tab bar
        // (`drag-region`, default stacking) so the top edge isn't visually
        // covered by it. `no-drag` ensures clicks on the title row don't
        // get hijacked by the underlying drag region at the OS level.
        'no-drag fixed top-2 bottom-2 right-2 z-[150]',
        // Width sizing:
        //   - `w-[45%]`   — scales up gracefully on wide displays
        //   - `min-w-[520px]` — holds a usable column even at the
        //     Electron window's `minWidth: 800` (see electron/main.ts).
        //     Bumped up from 420 px because at 800 px viewport the
        //     45 % preferred width collapses to 360 px and the issue
        //     detail (title + meta + status + activity rail) needs
        //     more elbow room to stay scannable.
        //   - `max-w-[70%]` — caps coverage on very wide displays so
        //     the underlying list never disappears entirely behind it.
        'flex flex-col w-[45%] min-w-[520px] max-w-[70%]',
        'rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
        'shadow-2xl outline-none overflow-hidden',
        phase === 'enter' && 'side-panel-enter',
        phase === 'exit' && 'side-panel-exit',
      )}
    >
      {children(requestClose)}
    </div>
  )

  const tree = modal ? (
    <div
      className="fixed inset-0 z-[150] overscroll-contain no-drag"
      onClick={handleOutsideClick}
    >
      {panel}
    </div>
  ) : (
    panel
  )

  return createPortal(tree, document.body)
})
