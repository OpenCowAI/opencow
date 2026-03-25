// SPDX-License-Identifier: Apache-2.0

import { memo, useRef, useMemo, useState, useCallback, useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { List } from 'lucide-react'
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
}

export const MarkdownPreviewWithToc = memo(function MarkdownPreviewWithToc({
  content,
  className,
}: MarkdownPreviewWithTocProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const tocEntries = useMemo(() => extractToc(content), [content])
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null)

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

  // ── Click TOC → scroll to heading ────────────────────────────────────────
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
  }, [tocEntries, content])

  // ── Search overlay ──────────────────────────────────────────────────────
  // Rendered inside the scrollable content area, NOT as a sibling of Group.
  // Placing it at the wrapper level would require `position: relative` on
  // the outer div and inject a DOM node before the Group — both of which
  // alter the scroll-ancestor chain that react-resizable-panels' overflow:
  // hidden wrappers rely on.
  const searchOverlay = search.isOpen ? (
    <TextSearchBar search={search} />
  ) : (
    <SearchTrigger onOpen={search.open} />
  )

  // No headings → full-width preview without TOC
  if (tocEntries.length === 0) {
    return (
      <div className={cn('overflow-hidden relative', className)}>
        {searchOverlay}
        <div ref={scrollRef} className="h-full overflow-y-auto px-6 py-4">
          <MarkdownContent content={content} />
        </div>
      </div>
    )
  }

  // Wrap Group in a fixed-height container because react-resizable-panels
  // sets `height: 100%` via inline styles on Group, which would override
  // any Tailwind height class applied directly to Group.
  return (
    <div className={cn('overflow-hidden', className)}>
      <Group id="md-preview-toc-layout" orientation="horizontal" className="min-h-0">
        {/* Left: TOC sidebar */}
        <Panel id="md-toc-panel" defaultSize="28%" minSize="15%" maxSize="40%">
          <TocSidebar
            entries={tocEntries}
            activeId={activeHeadingId}
            onSelect={handleTocSelect}
          />
        </Panel>

        <Separator className="w-px bg-[hsl(var(--border))] relative hover:bg-[hsl(var(--ring)/0.5)] transition-colors">
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </Separator>

        {/* Right: rendered Markdown content.
             className="flex flex-col" makes the Panel inner wrapper a column
             flex container so the scroll area can be sized with flex-1 instead
             of h-full — avoiding percentage-height resolution issues inside the
             library's nested flex wrappers. */}
        <Panel id="md-content-panel" minSize="50%" className="relative flex flex-col">
          {searchOverlay}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            <MarkdownContent content={content} />
          </div>
        </Panel>
      </Group>
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
}

/** Per-level left padding: level 1 → 12px, level 2 → 28px, etc. */
function tocPaddingLeft(level: number): number {
  return 12 + (level - 1) * 16
}

const TocSidebar = memo(function TocSidebar({
  entries,
  activeId,
  onSelect,
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
        Contents
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
