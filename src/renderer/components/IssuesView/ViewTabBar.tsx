// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, MoreHorizontal } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { setActiveView } from '../../actions/issueActions'
import { useModalAnimation } from '../../hooks/useModalAnimation'
import { cn } from '../../lib/utils'
import { ViewEditPopover } from './ViewEditPopover'
import { ALL_VIEW } from '@shared/types'
import type { IssueView } from '@shared/types'

// ---------------------------------------------------------------------------
// Layout constants — used to reserve right-side space when computing overflow
// ---------------------------------------------------------------------------

/** Width (px) of the More (···) button (used to recover baseline when More is visible) */
const MORE_BTN_W  = 36
/** Left padding (pl-4) of the tab container — excluded from usable tab area */
const PADDING_LEFT = 16
/** gap-0.5 between tabs */
const TAB_GAP     = 2

// ---------------------------------------------------------------------------
// SortableTab — a single draggable custom-view tab
// ---------------------------------------------------------------------------

interface SortableTabProps {
  view: IssueView
  isActive: boolean
  count?: number
  onActivate: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

function SortableTab({
  view,
  isActive,
  count,
  onActivate,
  onContextMenu,
}: SortableTabProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: view.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      className={cn(
        'relative flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap rounded-md transition-colors select-none',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        isActive
          ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--foreground)/0.06)]'
          : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
        isDragging && 'cursor-grabbing'
      )}
    >
      {view.icon && <span className="text-xs">{view.icon}</span>}
      <span>{view.name}</span>
      {count !== undefined && count > 0 && (
        <CountBadge count={count} isActive={isActive} />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// CountBadge — shared count pill used in tabs
// ---------------------------------------------------------------------------

function CountBadge({ count, isActive }: { count: number; isActive: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'ml-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 text-center tabular-nums',
        isActive
          ? 'bg-[hsl(var(--foreground)/0.12)] text-[hsl(var(--foreground)/0.7)]'
          : 'bg-[hsl(var(--foreground)/0.07)] text-[hsl(var(--muted-foreground))]'
      )}
    >
      {count > 999 ? '999+' : count}
    </span>
  )
}

// ---------------------------------------------------------------------------
// TabOverlay — drag overlay rendering for the dragged tab
// ---------------------------------------------------------------------------

function TabOverlay({ view }: { view: IssueView }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap rounded-md bg-[hsl(var(--card))] shadow-md border border-[hsl(var(--border))] text-[hsl(var(--foreground))] font-medium">
      {view.icon && <span className="text-xs">{view.icon}</span>}
      <span>{view.name}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Popover state
// ---------------------------------------------------------------------------

interface PopoverState {
  view: IssueView | null
  anchorRect: DOMRect | null
}

// ---------------------------------------------------------------------------
// ViewTabBar
// ---------------------------------------------------------------------------

export function ViewTabBar(): React.JSX.Element {
  const { t } = useTranslation('navigation')
  const issueViews      = useIssueStore((s) => s.issueViews)
  const activeViewId    = useAppStore((s) => s.activeViewId)
  const reorderIssueViews = useIssueStore((s) => s.reorderIssueViews)
  const loadIssueViews  = useIssueStore((s) => s.loadIssueViews)
  const viewIssueCounts = useIssueStore((s) => s.viewIssueCounts)

  // ── On mount: load custom views ──────────────────────────────────────────
  useEffect(() => {
    loadIssueViews()
  }, [loadIssueViews])

  // ── Overflow detection ───────────────────────────────────────────────────
  //
  // Strategy: a hidden "measurement layer" renders all tabs (All + custom)
  // with identical styling so we can read their exact offsetWidth values.
  // A ResizeObserver on the visible container then computes how many tabs fit.
  //
  // `overflowStart` is the index into `[ALL_VIEW, ...issueViews]` where the
  // visible list ends; tabs from that index onwards go into the More popover.
  // Initial value = total length so all tabs are visible before measurement.

  const containerRef    = useRef<HTMLDivElement>(null)
  const measureRefs     = useRef<(HTMLDivElement | null)[]>([])
  const tabWidthCache   = useRef<number[]>([])

  // All tab items in display order: All first, then custom views
  // (no useMemo needed — issueViews reference changes on updates anyway)
  const allTabItems = [ALL_VIEW, ...issueViews]

  const [overflowStart, setOverflowStart] = useState(allTabItems.length)

  // Keep a ref that's always current so computeOverflow (used inside
  // ResizeObserver) can read the latest overflowStart without stale closure.
  const overflowStartRef = useRef(overflowStart)
  useEffect(() => { overflowStartRef.current = overflowStart }, [overflowStart])

  // Also keep a ref for allTabItems.length for the same reason.
  const tabCountRef = useRef(allTabItems.length)
  useEffect(() => { tabCountRef.current = allTabItems.length }, [allTabItems.length])

  // Measure widths from the hidden layer after every tab-list or count update
  useLayoutEffect(() => {
    measureRefs.current.forEach((el, i) => {
      if (el) tabWidthCache.current[i] = el.offsetWidth
    })
  }, [allTabItems.length, viewIssueCounts])

  // Compute how many tabs fit in the available container width.
  //
  // Key insight: when the More button is visible it lives in a sibling
  // `shrink-0` div, which causes the `flex-1` tab container to shrink by
  // ~MORE_BTN_W px.  To get a stable, oscillation-free result we always
  // recover that width before comparing, giving a consistent baseline (baseW).
  //
  //   baseW = containerW                      (More hidden — already full width)
  //   baseW = containerW + MORE_BTN_W + gap   (More visible — recover its space)
  //
  // Then:
  //   tabAreaW  = baseW - PADDING_LEFT                 (usable tab area)
  //   all fit?  totalW ≤ tabAreaW
  //   cutAt?    tabs that fit in tabAreaW - MORE_BTN_W - gap
  const computeOverflow = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const containerW = container.clientWidth
    const tabCount   = tabCountRef.current

    // Recover More-button width when it is currently displayed so we always
    // compare against the same hypothetical "full-width" baseline.
    const moreIsVisible = overflowStartRef.current < tabCount
    const baseW    = moreIsVisible ? containerW + MORE_BTN_W + TAB_GAP : containerW
    const tabAreaW = baseW - PADDING_LEFT

    // Total width of all tabs (using cached measurements)
    let totalW = 0
    for (let i = 0; i < tabCount; i++) {
      totalW += (tabWidthCache.current[i] ?? 72) + TAB_GAP
    }

    if (totalW <= tabAreaW) {
      // All tabs fit — no More button needed
      setOverflowStart(tabCount)
      return
    }

    // Need More — compute how many tabs fit once More takes its space
    const availableWithMore = tabAreaW - MORE_BTN_W - TAB_GAP
    let used = 0
    let cutAt = 0
    for (let i = 0; i < tabCount; i++) {
      const w = (tabWidthCache.current[i] ?? 72) + TAB_GAP
      if (used + w > availableWithMore) break
      used += w
      cutAt = i + 1
    }
    // Always show at least the All tab (index 0)
    setOverflowStart(Math.max(1, cutAt))
  }, []) // no deps — reads everything via refs

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    computeOverflow()
    const ro = new ResizeObserver(computeOverflow)
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeOverflow])

  // Recompute after tab widths change (badge counts update, tabs added/removed)
  useLayoutEffect(() => {
    computeOverflow()
  }, [allTabItems.length, viewIssueCounts, computeOverflow])

  // ── Derived state ────────────────────────────────────────────────────────

  const visibleTabItems  = allTabItems.slice(0, overflowStart)
  const overflowTabItems = allTabItems.slice(overflowStart)
  const hasOverflow      = overflowTabItems.length > 0
  const activeInOverflow = overflowTabItems.some((v) => v.id === activeViewId)

  // Custom views that are visible (for DnD SortableContext)
  const visibleCustomViews = visibleTabItems.filter(
    (v): v is IssueView => v.id !== ALL_VIEW.id
  )
  const sortableIds = visibleCustomViews.map((v) => v.id)

  // ── More popover ─────────────────────────────────────────────────────────

  const moreButtonRef    = useRef<HTMLButtonElement>(null)
  const morePopoverRef   = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos]   = useState({ top: 0, left: 0 })
  const { mounted: moreMounted, phase: morePhase } = useModalAnimation(moreOpen)
  const moreHoverTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMoreEnter = useCallback(() => {
    if (moreHoverTimer.current) { clearTimeout(moreHoverTimer.current); moreHoverTimer.current = null }
    if (moreButtonRef.current) {
      const rect = moreButtonRef.current.getBoundingClientRect()
      setMorePos({ top: rect.bottom + 4, left: rect.left })
    }
    setMoreOpen(true)
  }, [])

  const handleMoreLeave = useCallback(() => {
    moreHoverTimer.current = setTimeout(() => setMoreOpen(false), 120)
  }, [])

  const handleMorePopoverEnter = useCallback(() => {
    if (moreHoverTimer.current) { clearTimeout(moreHoverTimer.current); moreHoverTimer.current = null }
  }, [])

  const handleMorePopoverLeave = useCallback(() => {
    moreHoverTimer.current = setTimeout(() => setMoreOpen(false), 120)
  }, [])

  useEffect(() => {
    return () => { if (moreHoverTimer.current) clearTimeout(moreHoverTimer.current) }
  }, [])

  // ── DnD sensors ──────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const [dragActiveView, setDragActiveView] = useState<IssueView | null>(null)

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const view = issueViews.find((v) => v.id === event.active.id)
      setDragActiveView(view ?? null)
    },
    [issueViews]
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveView(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      // Reorder within the full issueViews array (overflow views keep their positions)
      const oldIndex = issueViews.findIndex((v) => v.id === active.id)
      const newIndex  = issueViews.findIndex((v) => v.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return

      const reordered = arrayMove(issueViews, oldIndex, newIndex)
      reorderIssueViews(reordered.map((v) => v.id))
    },
    [issueViews, reorderIssueViews]
  )

  const handleDragCancel = useCallback(() => setDragActiveView(null), [])

  // ── ViewEditPopover handlers ──────────────────────────────────────────────

  const addButtonRef = useRef<HTMLButtonElement>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const handleCreateView = useCallback(() => {
    const rect = addButtonRef.current?.getBoundingClientRect() ?? null
    setPopover({ view: null, anchorRect: rect })
  }, [])

  const handleEditView = useCallback((e: React.MouseEvent, view: IssueView) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPopover({ view, anchorRect: rect })
  }, [])

  const handleClosePopover = useCallback(() => setPopover(null), [])

  // ── Render ────────────────────────────────────────────────────────────────

  const allCount    = viewIssueCounts[ALL_VIEW.id]
  const isAllActive = activeViewId === ALL_VIEW.id

  return (
    <div className="flex items-center border-b border-[hsl(var(--border)/0.5)]">

      {/* ── Hidden measurement layer ──────────────────────────────────────
          Renders all tabs (with badges) off-screen so we can read their
          exact pixel widths for overflow computation.                    */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 invisible pointer-events-none flex items-center"
        style={{ gap: TAB_GAP }}
      >
        {allTabItems.map((tab, i) => {
          const cnt = viewIssueCounts[tab.id]
          return (
            <div
              key={tab.id}
              ref={(el) => { measureRefs.current[i] = el }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap"
            >
              {tab.icon && <span className="text-xs">{tab.icon}</span>}
              <span>{tab.id === ALL_VIEW.id ? t('issueViews.all') : tab.name}</span>
              {cnt !== undefined && cnt > 0 && (
                <span className="ml-0.5 min-w-[16px] h-4 px-1 text-[10px]">
                  {cnt > 999 ? '999+' : cnt}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Visible tabs (flex, overflow hidden — no scroll) ──────────── */}
      <div
        ref={containerRef}
        className="flex items-center gap-0.5 pl-4 py-1 flex-1 min-w-0 overflow-hidden"
        role="tablist"
        aria-label={t('issueViews.views')}
      >
        {/* All tab — fixed, not draggable */}
        <button
          role="tab"
          aria-selected={isAllActive}
          onClick={() => setActiveView(ALL_VIEW.id)}
          className={cn(
            'relative flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap rounded-md transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            isAllActive
              ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--foreground)/0.06)]'
              : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
          )}
        >
          {t('issueViews.all')}
          {allCount !== undefined && allCount > 0 && (
            <CountBadge count={allCount} isActive={isAllActive} />
          )}
        </button>

        {/* Visible custom view tabs — sortable */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            {visibleCustomViews.map((view) => (
              <SortableTab
                key={view.id}
                view={view}
                isActive={activeViewId === view.id}
                count={viewIssueCounts[view.id]}
                onActivate={() => setActiveView(view.id)}
                onContextMenu={(e) => handleEditView(e, view)}
              />
            ))}
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
            {dragActiveView ? <TabOverlay view={dragActiveView} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* ── Fixed right-side controls ─────────────────────────────────── */}
      <div className="flex items-center gap-1 pr-2 shrink-0">

        {/* More (···) — only when tabs overflow */}
        {hasOverflow && (
          <button
            ref={moreButtonRef}
            onMouseEnter={handleMoreEnter}
            onMouseLeave={handleMoreLeave}
            aria-label={t('issueViews.moreViews')}
            aria-haspopup="true"
            aria-expanded={moreOpen}
            className={cn(
              'flex items-center justify-center p-1.5 rounded-md transition-colors',
              activeInOverflow || moreOpen
                ? 'text-[hsl(var(--foreground))] bg-[hsl(var(--foreground)/0.06)]'
                : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
            )}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        )}

        {/* + Add view — always visible */}
        <button
          ref={addButtonRef}
          onClick={handleCreateView}
          aria-label={t('issueViews.createNewView')}
          className="flex-none flex items-center justify-center p-1 rounded-lg border border-dashed border-[hsl(var(--border)/0.5)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground)/0.2)] transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* ── More popover (fixed positioning) ─────────────────────────── */}
      {moreMounted && (
        <div
          ref={morePopoverRef}
          style={{ position: 'fixed', top: morePos.top, left: morePos.left, zIndex: 50 }}
          onMouseEnter={handleMorePopoverEnter}
          onMouseLeave={handleMorePopoverLeave}
          className={cn(
            'w-52 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg overflow-hidden',
            morePhase === 'enter' && 'dropdown-enter',
            morePhase === 'exit'  && 'dropdown-exit',
          )}
        >
          <div className="py-1">
            {overflowTabItems.map((tab) => {
              const isCustom   = tab.id !== ALL_VIEW.id
              const isActive   = activeViewId === tab.id
              const cnt        = viewIssueCounts[tab.id]

              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveView(tab.id); setMoreOpen(false) }}
                  onContextMenu={isCustom ? (e) => handleEditView(e, tab as IssueView) : undefined}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                    isActive
                      ? 'text-[hsl(var(--foreground))] font-medium bg-[hsl(var(--foreground)/0.06)]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]'
                  )}
                >
                  {tab.icon && <span className="text-xs">{tab.icon}</span>}
                  <span className="flex-1 truncate">
                    {tab.id === ALL_VIEW.id ? t('issueViews.all') : tab.name}
                  </span>
                  {cnt !== undefined && cnt > 0 && (
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))] tabular-nums">
                      {cnt > 999 ? '999+' : cnt}
                    </span>
                  )}
                  {isActive && (
                    <span className="text-[hsl(var(--primary))]">✓</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ViewEditPopover */}
      {popover && (
        <ViewEditPopover
          view={popover.view}
          anchorRect={popover.anchorRect}
          onClose={handleClosePopover}
        />
      )}
    </div>
  )
}
