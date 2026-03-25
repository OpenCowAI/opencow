// SPDX-License-Identifier: Apache-2.0

/**
 * StopButtonPopover — Shared stop-session button with confirmation popover.
 *
 * Renders an animated stop icon (spinning ring + breathing filled square) that,
 * when clicked, opens a PillDropdown popover asking the user to confirm.
 *
 * Used inside any chat/session input bar to provide a unified "send → stop"
 * dual-mode experience during agent processing.
 *
 * Size variants:
 *   - 'sm' (default): compact inputs (SessionInputBar, ReviewChatPanel)
 *   - 'md': spacious inputs (ChatHeroInput)
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Square } from 'lucide-react'
import { PillDropdown } from './PillDropdown'
import { cn } from '@/lib/utils'

// ─── Shared type ────────────────────────────────────────────────────────────

/** Session-level control props for the send button's dual-mode behavior. */
export interface SessionControlProps {
  /** Whether the session is actively processing (creating/streaming). */
  isProcessing: boolean
  /** Callback to stop the current session. */
  onStop: () => void
}

// ─── Component ──────────────────────────────────────────────────────────────

interface StopButtonPopoverProps {
  /** Callback to stop the current session. */
  onStop: () => void
  /** Button/icon size — 'sm' for compact inputs, 'md' for hero inputs. */
  size?: 'sm' | 'md'
}

export function StopButtonPopover({
  onStop,
  size = 'sm',
}: StopButtonPopoverProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const [isOpen, setIsOpen] = useState(false)

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const handleConfirm = useCallback(() => {
    setIsOpen(false)
    onStop()
  }, [onStop])

  const isMd = size === 'md'

  return (
    <PillDropdown
      open={isOpen}
      onOpenChange={setIsOpen}
      position="above"
      align="right"
      trigger={
        <button
          type="button"
          onClick={handleToggle}
          title={t('sessionInput.stopSessionTooltip')}
          className={cn(
            'relative rounded-full transition-all shrink-0',
            isMd ? 'p-1.5' : 'p-1',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
            isOpen
              ? 'text-red-500 bg-red-500/10'
              : 'text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-500/10'
          )}
          aria-label={t('sessionInput.stopSessionAria')}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
        >
          {/* Processing spinner ring */}
          <span
            className="absolute inset-0 rounded-full border-[1.5px] border-transparent border-t-current opacity-40 motion-safe:animate-spin pointer-events-none"
            aria-hidden="true"
          />
          {/* Filled square stop icon with breathing animation */}
          <Square
            className={cn(
              'relative motion-safe:animate-[stop-icon-breathe_2s_ease-in-out_infinite]',
              isMd ? 'w-4 h-4' : 'w-3.5 h-3.5'
            )}
            fill="currentColor"
            strokeWidth={0}
            aria-hidden="true"
          />
        </button>
      }
    >
      <div className="p-3 space-y-2.5 min-w-[180px]">
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">
          {t('sessionInput.stopConfirmTitle')}
        </p>
        <button
          onClick={handleConfirm}
          className="w-full px-3 py-1.5 text-xs font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          {t('sessionInput.stopConfirmBtn')}
        </button>
      </div>
    </PillDropdown>
  )
}
