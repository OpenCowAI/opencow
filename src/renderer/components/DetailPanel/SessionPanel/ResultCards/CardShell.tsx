// SPDX-License-Identifier: Apache-2.0

/**
 * CardShell — shared container for all tool result cards.
 *
 * Provides consistent border, background, rounded corners, and max-width
 * across IssueResultCard, ProjectResultCard, and future card types.
 *
 * Extracted to eliminate 8+ repetitions of the same container class string
 * and ensure visual consistency when new card types are added.
 */

import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

interface CardShellProps {
  children: React.ReactNode
  /** Maximum width constraint. Defaults to 'md'. */
  maxWidth?: 'sm' | 'md' | 'lg'
  /** Additional CSS classes merged onto the container. */
  className?: string
}

// ─── Width mapping ──────────────────────────────────────────────────────────

const MAX_WIDTH_CLASSES: Record<NonNullable<CardShellProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CardShell({
  children,
  maxWidth = 'md',
  className,
}: CardShellProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'ml-4 mt-1 rounded-xl border border-[hsl(var(--border)/0.5)]',
        'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] overflow-hidden',
        MAX_WIDTH_CLASSES[maxWidth],
        className,
      )}
    >
      {children}
    </div>
  )
}
