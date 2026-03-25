// SPDX-License-Identifier: Apache-2.0

import { useRef, useState, useCallback, useLayoutEffect, useEffect } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// MarkdownTable — World-class table rendering for markdown content
//
// Architecture:
//   MarkdownTable (card container with horizontal scroll + edge shadow indicators)
//   ├── MarkdownThead (header group with muted background)
//   │   └── tr
//   │       └── MarkdownTh (header cell — preserves GFM text-align)
//   └── MarkdownTbody (body group with row hover)
//       └── MarkdownTr (row with border separator)
//           └── MarkdownTd (data cell — preserves GFM text-align)
//
// Features:
//   - Card container with rounded corners and subtle border
//   - Horizontal scroll with animated edge shadow indicators
//   - Distinct header with muted background for visual hierarchy
//   - Row hover effect (body rows only — header stays constant)
//   - GFM text-align passthrough via style prop forwarding
//   - Accessible scrollable region with keyboard support
//   - Streaming-safe: renders partial tables as content arrives
//   - Virtuoso-compatible: all positioning within flow, no portals
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// useScrollShadows — detects horizontal overflow for edge shadow indicators
//
// Measurement strategy (follows useElementInset.ts pattern):
//
// | Track        | Mechanism                           | Catches                         |
// |--------------|-------------------------------------|---------------------------------|
// | Synchronous  | useLayoutEffect (mount)             | Initial state before first paint|
// | Content size | ResizeObserver on inner <table>      | Streaming rows/columns added    |
// | Container    | ResizeObserver on scroll container   | Panel resize, window resize     |
// | User scroll  | passive scroll listener             | Manual horizontal scroll        |
//
// IMPORTANT — Virtuoso compatibility:
// Must NOT use useLayoutEffect without deps. Inside Virtuoso's virtualised
// list, any state change → DOM class change → Virtuoso re-measures item →
// re-renders all visible items → useLayoutEffect fires again → cascade.
// Instead, content changes are detected via ResizeObserver on the inner
// <table> element, whose borderBoxSize changes when rows/columns are added.
// ---------------------------------------------------------------------------

interface ScrollShadowState {
  left: boolean
  right: boolean
}

function useScrollShadows(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLTableElement | null>,
): ScrollShadowState {
  const [shadows, setShadows] = useState<ScrollShadowState>({ left: false, right: false })

  const sync = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const { scrollLeft, scrollWidth, clientWidth } = el
    const left = scrollLeft > 1
    // -1 accounts for sub-pixel rounding in some browsers
    const right = scrollLeft + clientWidth < scrollWidth - 1

    // Referential identity guard — avoids re-render when values haven't changed.
    // React bails out of rendering when useState returns the same reference.
    setShadows((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right }
    )
  }, [scrollRef])

  // ── Synchronous track — initial mount only ────────────────────────────
  // Fires once before first paint to set correct shadow state without flash.
  // Uses [sync] as dep — sync is stable (useCallback with stable ref dep),
  // so this fires exactly once on mount.
  useLayoutEffect(() => { sync() }, [sync])

  // ── Asynchronous track — runtime changes ──────────────────────────────
  // Two-target ResizeObserver strategy:
  //   1. Inner <table>  — catches content-driven size changes (streaming adds
  //      rows/columns → table borderBoxSize changes → scrollWidth changes).
  //      This is the key insight: observing the scroll CONTAINER alone misses
  //      scrollWidth changes because the container's borderBoxSize stays fixed
  //      when only its internal content grows.
  //   2. Scroll container — catches parent-driven width changes (panel drag,
  //      window resize → container clientWidth changes → scrollability changes).
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return

    const ro = new ResizeObserver(sync)
    ro.observe(scrollEl)

    const tableEl = contentRef.current
    if (tableEl) ro.observe(tableEl)

    scrollEl.addEventListener('scroll', sync, { passive: true })

    return () => {
      ro.disconnect()
      scrollEl.removeEventListener('scroll', sync)
    }
  }, [scrollRef, contentRef, sync])

  return shadows
}

// ---------------------------------------------------------------------------
// MarkdownTable — card container with scroll shadow indicators
// ---------------------------------------------------------------------------

/**
 * Top-level table wrapper registered as `table` in MARKDOWN_COMPONENTS.
 *
 * Wraps the HTML `<table>` in a card-like container with rounded corners,
 * a subtle border, and horizontal scroll. When content overflows, animated
 * edge shadow indicators appear to signal that more data is available.
 *
 * The container is transparent so tables blend naturally with the document
 * background. Edge shadow gradients fade to `--background` to match.
 */
export function MarkdownTable({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const shadows = useScrollShadows(scrollRef, tableRef)

  return (
    <div className="my-2.5 rounded-lg border border-[hsl(var(--border)/0.5)] overflow-hidden">
      <div className="relative">
        {/* Edge shadow — left */}
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-5 z-10 transition-opacity duration-150',
            shadows.left ? 'opacity-100' : 'opacity-0',
          )}
          style={{ background: 'linear-gradient(to right, hsl(var(--background)), transparent)' }}
          aria-hidden="true"
        />

        {/* Edge shadow — right */}
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 right-0 w-5 z-10 transition-opacity duration-150',
            shadows.right ? 'opacity-100' : 'opacity-0',
          )}
          style={{ background: 'linear-gradient(to left, hsl(var(--background)), transparent)' }}
          aria-hidden="true"
        />

        <div
          ref={scrollRef}
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
          tabIndex={0}
          role="region"
          aria-label="Data table"
        >
          <table ref={tableRef} className="min-w-full text-sm border-collapse">{children}</table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components — lightweight, no state
// ---------------------------------------------------------------------------

/** Table header group — subtle muted background for visual hierarchy. */
export function MarkdownThead({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <thead className="bg-[hsl(var(--muted)/0.5)]">
      {children}
    </thead>
  )
}

/**
 * Table body group — owns the row hover effect via child selector.
 *
 * Hover is scoped to `tbody > tr` (not all `tr`) so header rows
 * keep their constant muted background without dimming on hover.
 */
export function MarkdownTbody({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <tbody className="[&>tr:hover]:bg-[hsl(var(--muted)/0.3)] [&>tr]:transition-colors">
      {children}
    </tbody>
  )
}

/** Table row — border separator between rows. */
export function MarkdownTr({ children }: { children?: React.ReactNode }): React.JSX.Element {
  return (
    <tr className="border-b border-[hsl(var(--border)/0.15)] last:border-b-0">
      {children}
    </tr>
  )
}

/**
 * Header cell — compact typography with preserved GFM text-align.
 *
 * The `style` prop carries `textAlign` from remark-gfm's column alignment
 * syntax (`:---`, `:---:`, `---:`). Inline styles override the default
 * `text-left` Tailwind class due to higher CSS specificity.
 */
export function MarkdownTh({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <th
      className="border-b border-[hsl(var(--border)/0.6)] px-3 py-2 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))] whitespace-nowrap"
      style={style}
    >
      {children}
    </th>
  )
}

/**
 * Data cell — with preserved GFM text-align.
 *
 * Same `style` forwarding as `MarkdownTh` for alignment passthrough.
 */
export function MarkdownTd({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }): React.JSX.Element {
  return (
    <td
      className="border-b border-[hsl(var(--border)/0.15)] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
      style={style}
    >
      {children}
    </td>
  )
}
