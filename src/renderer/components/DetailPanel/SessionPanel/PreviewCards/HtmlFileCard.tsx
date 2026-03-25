// SPDX-License-Identifier: Apache-2.0

/**
 * HtmlFileCard — Browser-style inline HTML preview card.
 *
 * Displays a compact browser-chrome thumbnail of generated HTML content
 * below the gen_html tool pill in the session console.
 *
 * ## States
 * - **generating**: Shimmer skeleton while Claude is streaming HTML content
 * - **generated**: CSS-scaled iframe preview (renders at 2× then scale-50)
 * - **error**: Inline error indicator (e.g. stream interrupted before content)
 *
 * ## Security
 * Card uses `sandbox=""` (strictest — no scripts, no forms, no popups).
 * `pointer-events-none` prevents user interaction with iframe content;
 * clicks pass through to the card itself, opening the full preview dialog.
 *
 * ## Layout
 * Card width: max-w-sm (384px). Viewport area: aspect-[16/10] (browser ratio).
 * CSS `transform: scale(0.5)` renders HTML at ~768px viewport then shrinks to fit.
 */

import { Globe, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ───────────────────────────────────────────────────────────────────

export type HtmlCardStatus = 'generating' | 'generated' | 'error'

interface HtmlFileCardProps {
  /** Page title from gen_html tool input */
  title: string
  /** Complete HTML content (null during generation or on error) */
  content: string | null
  /** Current lifecycle state */
  status: HtmlCardStatus
  /** Opens full-screen preview dialog */
  onClick: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function HtmlFileCard({
  title,
  content,
  status,
  onClick,
}: HtmlFileCardProps): React.JSX.Element {
  const isClickable = status === 'generated'

  return (
    <div
      className={cn(
        'max-w-sm rounded-xl border border-[hsl(var(--border)/0.5)]',
        'bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
        'transition-colors group overflow-hidden',
        isClickable && 'cursor-pointer hover:border-[hsl(var(--primary)/0.5)]',
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? `Preview ${title}` : undefined}
      onKeyDown={isClickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      } : undefined}
    >
      {/* Browser chrome header */}
      <BrowserChrome title={title} status={status} />

      {/* Viewport — state-driven content */}
      <BrowserViewport content={content} title={title} status={status} />

      {/* Hover hint — only when clickable */}
      {isClickable && (
        <div className="px-3 py-1 text-[10px] text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 transition-opacity">
          Click to open full preview
        </div>
      )}
    </div>
  )
}

// ─── Browser Chrome ──────────────────────────────────────────────────────────

function BrowserChrome({
  title,
  status,
}: {
  title: string
  status: HtmlCardStatus
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[hsl(var(--border)/0.5)] bg-[hsl(var(--muted)/0.3)]">
      {/* Traffic-light dots (decorative) */}
      <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
        <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
        <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
        <div className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground)/0.2)]" />
      </div>
      {/* URL bar */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md bg-[hsl(var(--background)/0.6)] px-2 py-0.5">
        <Globe
          className="w-2.5 h-2.5 shrink-0 text-[hsl(var(--muted-foreground)/0.5)]"
          aria-hidden="true"
        />
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate font-mono">
          {title}
        </span>
        {status === 'generating' && (
          <Loader2
            className="w-2.5 h-2.5 shrink-0 ml-auto motion-safe:animate-spin text-[hsl(var(--muted-foreground)/0.4)]"
            aria-label="Generating HTML"
          />
        )}
      </div>
    </div>
  )
}

// ─── Browser Viewport ────────────────────────────────────────────────────────

function BrowserViewport({
  content,
  title,
  status,
}: {
  content: string | null
  title: string
  status: HtmlCardStatus
}): React.JSX.Element {
  if (status === 'generating') {
    return (
      <div className="aspect-[16/10] bg-[hsl(var(--muted)/0.15)] animate-pulse flex items-center justify-center">
        <div className="flex flex-col items-center gap-1.5">
          <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground)/0.3)]" />
          <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)]">Generating…</span>
        </div>
      </div>
    )
  }

  if (status === 'error' || !content) {
    return (
      <div className="aspect-[16/10] bg-[hsl(var(--muted)/0.1)] flex flex-col items-center justify-center gap-1.5">
        <AlertTriangle className="w-5 h-5 text-[hsl(var(--muted-foreground)/0.3)]" />
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">Failed to generate</span>
      </div>
    )
  }

  // Generated — CSS-scaled iframe preview
  // Renders at 2× container width (~768px) via w-[200%], then scale(0.5) shrinks to fit.
  // Uses explicit transform (not Tailwind scale-*) to ensure transform-origin is respected.
  return (
    <div className="relative aspect-[16/10] overflow-hidden pointer-events-none" style={{ contain: 'strict' }}>
      <iframe
        srcDoc={content}
        sandbox=""
        title={`HTML thumbnail: ${title}`}
        className="absolute top-0 left-0 w-[200%] h-[200%] border-0 bg-white"
        style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}
        tabIndex={-1}
      />
    </div>
  )
}
