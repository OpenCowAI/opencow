// SPDX-License-Identifier: Apache-2.0

import { memo, useRef, useMemo, useState, useCallback, useEffect } from 'react'
import { ChevronLeft, List } from 'lucide-react'
import { useModalAnimation } from '@/hooks/useModalAnimation'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './MarkdownContent'
import { TextSearchBar, SearchTrigger } from './TextSearchBar'
import { extractToc, type TocEntry } from '@/lib/extractToc'
import { useTextSearch } from '@/hooks/useTextSearch'

// ---------------------------------------------------------------------------
// MarkdownPreviewWithToc
//
// A reusable composite component that renders Markdown with an optional
// Table-of-Contents sidebar on the left. Used in all Markdown preview dialogs.
//
// Features:
// - Resizable TOC sidebar (hidden when no headings)
// - IntersectionObserver-driven active heading tracking
// - Ctrl/Cmd+F in-content text search via CSS Custom Highlight API
// ---------------------------------------------------------------------------

interface MarkdownPreviewWithTocProps {
  content: string
  /** Passed to the outermost container (typically `h-[82vh]`). */
  className?: string
  /** Optional TOC title text. */
  tocLabel?: string
  /** Enable user-controlled TOC collapse/expand behavior. */
  enableTocCollapse?: boolean
  /** Initial TOC state when collapse is enabled. */
  defaultTocCollapsed?: boolean
  /** Extra controls rendered alongside the search in the top-right toolbar
   *  (e.g. preview/source toggle). They sit to the right of the search in
   *  a `gap-2` flex row — no manual offset math needed. */
  topRightSlot?: React.ReactNode
}

export const MarkdownPreviewWithToc = memo(function MarkdownPreviewWithToc({
  content,
  className,
  tocLabel = 'Contents',
  enableTocCollapse = false,
  defaultTocCollapsed = false,
  topRightSlot,
}: MarkdownPreviewWithTocProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tocEntries = useMemo(() => extractToc(content), [content])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)
  const [isTocOpen, setIsTocOpen] = useState<boolean>(() => !defaultTocCollapsed)

  // ── Text search ─────────────────────────────────────────────────────────
  const search = useTextSearch({ containerRef: scrollRef })

  // ── Ctrl/Cmd+F → open search bar ───────────────────────────────────────
  // Uses capture phase at the document level so the shortcut works regardless
  // of which element inside the dialog currently has focus, and prevents the
  // browser's native "Find in Page" from opening over the modal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        search.open()
      }
    }

    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [search.open])

  // ── Click TOC → scroll to heading (and close drawer if collapsible) ─────
  const handleTocSelect = useCallback((id: string) => {
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`#${CSS.escape(id)}`)
    if (!target) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [])

  const handleTocSelectAndClose = useCallback((id: string) => {
    handleTocSelect(id)
    if (enableTocCollapse) setIsTocOpen(false)
  }, [handleTocSelect, enableTocCollapse])

  // ── Assign heading IDs + IntersectionObserver ─────────────────────────────
  //
  // MarkdownContent's heading components generate IDs via a shared mutable
  // counter (slug deduplication ref) that is incremented during render.
  // React StrictMode (and any other double-invocation mechanism) causes each
  // heading component to render twice, doubling the counter — so DOM elements
  // end up with IDs like "heading-1" instead of "heading".
  //
  // extractToc is a pure function that always produces correct, deterministic
  // IDs.  This effect overwrites the DOM heading IDs with extractToc's output
  // (effects run once, outside the render phase) and then sets up the
  // IntersectionObserver on the corrected elements.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || tocEntries.length === 0) return

    // 1. Collect all heading elements in document order
    const headingEls = [
      ...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    ]

    // 2. Overwrite IDs with extractToc's deterministic output
    const count = Math.min(tocEntries.length, headingEls.length)
    for (let i = 0; i < count; i++) {
      headingEls[i].id = tocEntries[i].id
    }

    // 3. Set up IntersectionObserver on corrected heading elements
    const observedEls = headingEls.slice(0, count)
    if (observedEls.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeadingId(entry.target.id)
            break
          }
        }
      },
      {
        root: container,
        rootMargin: '0px 0px -80% 0px',
        threshold: 0,
      },
    )

    for (const el of observedEls) observer.observe(el)
    return () => observer.disconnect()
  }, [tocEntries, content, isTocOpen])

  // ── Search overlay ──────────────────────────────────────────────────────
  // Rendered inside the scrollable content area, NOT as a sibling of Group.
  // Placing it at the wrapper level would require `position: relative` on
  // the outer div and inject a DOM node before the Group — both of which
  // alter the scroll-ancestor chain that react-resizable-panels' overflow:
  // hidden wrappers rely on.
  // Top-right toolbar — single absolute container hosting search + optional
  // caller-provided controls. Items lay out in a flex row with `gap-2`, so
  // spacing stays correct as content widths change (no magic numbers).
  const topRightToolbar = (
    <div className="absolute top-2 right-2 z-20 flex items-center gap-2">
      {search.isOpen ? (
        <TextSearchBar search={search} />
      ) : (
        <SearchTrigger onOpen={search.open} />
      )}
      {topRightSlot}
    </div>
  )

  // No headings → full-width preview without TOC
  if (tocEntries.length === 0) {
    return (
      <div className={cn('overflow-hidden relative', className)}>
        {topRightToolbar}
        <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-4">
          <MarkdownContent content={content} />
        </div>
      </div>
    )
  }

  // TOC is presented as a slide-in drawer overlay anchored to the left edge
  // of the content area — clicking the trigger opens it; clicking outside,
  // clicking a TOC item, or pressing Escape closes it. The content area
  // stays at full width regardless of drawer state (the drawer floats on
  // top with backdrop-blur), so the preview never reflows.
  return (
    <div className={cn('overflow-hidden relative', className)}>
      {topRightToolbar}

      {/* Trigger — top-left. Visible whenever the drawer is closed
          (when collapse is enabled). When collapse is disabled the drawer
          stays open so no trigger is needed. */}
      {enableTocCollapse && !isTocOpen && (
        <TocCollapsedTrigger label={tocLabel} onExpand={() => setIsTocOpen(true)} />
      )}

      {/* Drawer — overlays the left strip of the content. */}
      <TocDrawer
        open={enableTocCollapse ? isTocOpen : true}
        entries={tocEntries}
        activeId={activeHeadingId}
        onSelect={handleTocSelectAndClose}
        label={tocLabel}
        onClose={enableTocCollapse ? () => setIsTocOpen(false) : undefined}
      />

      <div
        ref={scrollRef}
        className={cn(
          'h-full overflow-y-auto px-6 py-4',
          // Reserve constant top padding whenever the TOC is collapsible —
          // toggling the trigger / drawer must NOT reflow the content.
          enableTocCollapse && 'pt-8',
        )}
      >
        <MarkdownContent content={content} />
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// TocSidebar — Table of Contents tree
// ---------------------------------------------------------------------------

interface TocSidebarProps {
  entries: TocEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  label: string
  onCollapse?: () => void
}

/** Per-level left padding: level 1 → 12px, level 2 → 28px, etc. */
function tocPaddingLeft(level: number): number {
  return 12 + (level - 1) * 16
}

const TocSidebar = memo(function TocSidebar({
  entries,
  activeId,
  onSelect,
  label,
  onCollapse,
}: TocSidebarProps): React.JSX.Element {
  const navRef = useRef<HTMLElement>(null)

  // Auto-scroll the active TOC item into view when it changes
  useEffect(() => {
    if (!activeId || !navRef.current) return
    const btn = navRef.current.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`)
    if (!btn) return
    // `nearest` only scrolls when the element is outside the visible area
    btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Header — matches FileTree header style */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
        <List className="h-3 w-3" aria-hidden="true" />
        <span className="truncate">{label}</span>
        {onCollapse && (
          <button
            type="button"
            className={cn(
              'ml-auto p-0.5 rounded transition-colors',
              'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
              'hover:bg-[hsl(var(--foreground)/0.06)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            )}
            onClick={onCollapse}
            aria-label={label}
            title={label}
          >
            <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* TOC items */}
      <nav ref={navRef} className="flex-1 overflow-y-auto py-1" aria-label="Table of contents">
        {entries.map((entry) => {
          const isActive = entry.id === activeId
          return (
            <button
              key={entry.id}
              type="button"
              data-toc-id={entry.id}
              onClick={() => onSelect(entry.id)}
              className={cn(
                'block w-full text-left pr-3 py-1 text-[13px] truncate cursor-pointer',
                'transition-colors hover:bg-[hsl(var(--foreground)/0.04)]',
                'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]',
                isActive
                  ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--primary)/0.08)]'
                  : 'text-[hsl(var(--muted-foreground))]',
                entry.level >= 4 && 'text-xs',
              )}
              style={{ paddingLeft: tocPaddingLeft(entry.level) }}
              title={entry.text}
            >
              {entry.text}
            </button>
          )
        })}
      </nav>
    </div>
  )
})

// ---------------------------------------------------------------------------
// TocDrawer — slide-in overlay containing the TocSidebar
// ---------------------------------------------------------------------------

interface TocDrawerProps {
  open: boolean
  entries: TocEntry[]
  activeId: string | null
  onSelect: (id: string) => void
  label: string
  /** When provided, drawer is dismissible via outside-click, Esc, or its
   *  internal collapse button. When undefined the drawer stays open (the
   *  "always visible" mode used when `enableTocCollapse` is false). */
  onClose?: () => void
}

const TOC_DRAWER_WIDTH = 240

const TocDrawer = memo(function TocDrawer({
  open,
  entries,
  activeId,
  onSelect,
  label,
  onClose,
}: TocDrawerProps): React.JSX.Element | null {
  const { mounted, phase } = useModalAnimation(open)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click. Delay attach by one frame so the click that
  // *opened* the drawer (which is still bubbling) doesn't immediately close
  // it. The handler ignores clicks on the drawer itself or on the trigger
  // (which has data-toc-trigger).
  useEffect(() => {
    if (!open || !onClose) return
    let attached = false
    const id = requestAnimationFrame(() => {
      const handler = (e: MouseEvent): void => {
        if (!drawerRef.current) return
        const target = e.target as Node
        if (drawerRef.current.contains(target)) return
        const triggerEl = (target instanceof Element ? target.closest('[data-toc-trigger]') : null)
        if (triggerEl) return
        onClose()
      }
      document.addEventListener('mousedown', handler)
      attached = true
      ;(drawerRef.current as HTMLDivElement & { __tocOutsideHandler?: typeof handler }).__tocOutsideHandler = handler
    })
    return () => {
      cancelAnimationFrame(id)
      if (attached) {
        const node = drawerRef.current as
          | (HTMLDivElement & { __tocOutsideHandler?: (e: MouseEvent) => void })
          | null
        const handler = node?.__tocOutsideHandler
        if (handler) document.removeEventListener('mousedown', handler)
      }
    }
  }, [open, onClose])

  // Dismiss on Escape
  useEffect(() => {
    if (!open || !onClose) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      ref={drawerRef}
      className={cn(
        'absolute top-0 bottom-0 left-0 z-20',
        'bg-[hsl(var(--background)/0.96)] backdrop-blur-sm',
        'border-r border-[hsl(var(--border))] shadow-lg',
        phase === 'enter' && 'toc-drawer-enter',
        phase === 'exit' && 'toc-drawer-exit',
      )}
      style={{ width: TOC_DRAWER_WIDTH }}
      role="dialog"
      aria-label={label}
    >
      <TocSidebar
        entries={entries}
        activeId={activeId}
        onSelect={onSelect}
        label={label}
        onCollapse={onClose}
      />
    </div>
  )
})

interface TocCollapsedTriggerProps {
  label: string
  onExpand: () => void
}

const TocCollapsedTrigger = memo(function TocCollapsedTrigger({
  label,
  onExpand,
}: TocCollapsedTriggerProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onExpand}
      data-toc-trigger
      className={cn(
        'absolute top-2 left-4 z-30',
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg',
        'text-[11px] font-medium text-[hsl(var(--muted-foreground))]',
        'bg-[hsl(var(--card)/0.95)] backdrop-blur-sm',
        'border border-[hsl(var(--border))]',
        'hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
        'transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
      )}
      aria-label={label}
      title={label}
    >
      <List className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="uppercase tracking-wider">{label}</span>
    </button>
  )
})
