// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Link, FileText, X, Search, Plus } from 'lucide-react'
import type { ContextRef, IssueSummary, Artifact, ContextCandidateFilter } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { useProjectScope } from '../../contexts/ProjectScopeContext'

// ─── Types ────────────────────────────────────────────────────────────────

interface ContextCandidates {
  issues: IssueSummary[]
  artifacts: Artifact[]
}

interface ContextRefsPickerProps {
  value: ContextRef[]
  onChange: (refs: ContextRef[]) => void
}

interface PopoverCoords {
  /** Distance from viewport bottom to anchor top — positions popover above the button */
  bottom: number
  left: number
}

// Transition durations (ms)
const ENTER_MS = 150
const EXIT_MS  = 120

// Popover fixed width — wide enough for long Issue / Artifact titles
const POPOVER_WIDTH = 420

// ─── Component ────────────────────────────────────────────────────────────

export function ContextRefsPicker({ value, onChange }: ContextRefsPickerProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const { projectId } = useProjectScope()
  const [candidates, setCandidates] = useState<ContextCandidates>({ issues: [], artifacts: [] })
  const [search, setSearch] = useState('')

  // `open`      — controls whether popover is in the DOM
  // `isVisible` — controls CSS transition target (true = fully visible, false = hidden)
  //
  // Why separate? CSS `transition` interpolates from the *current* computed value,
  // so blur→focus mid-exit reversal is seamless — no jump back to translateY(4px).
  const [open, setOpen]           = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [coords, setCoords]       = useState<PopoverCoords>({ bottom: 0, left: 0 })

  const buttonRef      = useRef<HTMLButtonElement>(null)
  const popoverRef     = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const closeTimer     = useRef<ReturnType<typeof setTimeout>>(undefined)
  const visibilityRaf  = useRef<number>(undefined)

  useEffect(() => {
    const filter: ContextCandidateFilter | undefined = projectId ? { projectId } : undefined
    getAppAPI()['get-context-candidates'](filter).then(setCandidates).catch(() => {})
  }, [projectId])

  // ── Coord tracking (always-fresh via ResizeObserver + listeners) ─────────
  //
  // Coords are kept up-to-date continuously, not just at open time.
  // This eliminates any timing window where getBoundingClientRect() could
  // return a stale value when the popover opens.

  useEffect(() => {
    const update = (): void => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // Clamp left so the popover never overflows the right edge of the viewport.
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8)
      setCoords({
        bottom: window.innerHeight - rect.top + 4,
        left: Math.max(8, left),
      })
    }

    update()

    const ro = new ResizeObserver(update)
    if (buttonRef.current) ro.observe(buttonRef.current)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [])

  // ── Open / close ────────────────────────────────────────────────────────

  const openPopover = useCallback(() => {
    clearTimeout(closeTimer.current)
    cancelAnimationFrame(visibilityRaf.current!)

    if (!open) {
      // Mount first (at isVisible=false, opacity:0), then trigger transition on next frame.
      setOpen(true)
      visibilityRaf.current = requestAnimationFrame(() => {
        setIsVisible(true)
        // Focus the search input after the enter transition starts
        requestAnimationFrame(() => searchInputRef.current?.focus())
      })
    } else {
      // Already mounted (mid-exit): reverse the transition in-place
      setIsVisible(true)
    }
  }, [open])

  const closePopover = useCallback(() => {
    cancelAnimationFrame(visibilityRaf.current!)
    setIsVisible(false)                           // start exit transition
    closeTimer.current = setTimeout(() => {
      setOpen(false)                              // unmount after transition completes
      setSearch('')                               // reset search for next open
    }, EXIT_MS)
  }, [])

  // ── Click-outside detection ──────────────────────────────────────────────

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      const inButton  = buttonRef.current?.contains(target) ?? false
      const inPopover = popoverRef.current?.contains(target) ?? false
      if (!inButton && !inPopover) closePopover()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, closePopover])

  // ── Button toggle ────────────────────────────────────────────────────────

  const handleButtonClick = useCallback(() => {
    if (open) closePopover()
    else openPopover()
  }, [open, openPopover, closePopover])

  useEffect(() => () => {
    clearTimeout(closeTimer.current)
    cancelAnimationFrame(visibilityRaf.current!)
  }, [])

  // ── Data ────────────────────────────────────────────────────────────────

  const selectedIds = useMemo(() => new Set(value.map((r) => r.id)), [value])

  const filteredIssues = useMemo(
    () =>
      candidates.issues.filter(
        (i) => !selectedIds.has(i.id) && i.title.toLowerCase().includes(search.toLowerCase()),
      ),
    [candidates.issues, selectedIds, search],
  )

  const filteredArtifacts = useMemo(
    () =>
      candidates.artifacts.filter(
        (a) =>
          !selectedIds.has(a.id) &&
          (a.title || a.filePath || '').toLowerCase().includes(search.toLowerCase()),
      ),
    [candidates.artifacts, selectedIds, search],
  )

  const hasResults = filteredIssues.length > 0 || filteredArtifacts.length > 0

  const addRef = (ref: ContextRef): void => {
    onChange([...value, ref])
    setSearch('')
    // Re-focus search so the user can keep adding refs without re-opening
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const removeRef = (id: string): void => onChange(value.filter((r) => r.id !== id))

  const getLabel = (ref: ContextRef): string => {
    if (ref.type === 'issue') {
      return candidates.issues.find((i) => i.id === ref.id)?.title ?? ref.id
    }
    const a = candidates.artifacts.find((art) => art.id === ref.id)
    return a?.title || a?.filePath || ref.id
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((ref) => (
            <span
              key={ref.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-[hsl(var(--foreground)/0.08)] text-[hsl(var(--foreground)/0.7)]"
            >
              {ref.type === 'issue' ? (
                <Link className="w-3 h-3 shrink-0" />
              ) : (
                <FileText className="w-3 h-3 shrink-0" />
              )}
              <span className="max-w-[240px] truncate">{getLabel(ref)}</span>
              <button
                type="button"
                onClick={() => removeRef(ref.id)}
                className="ml-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                aria-label={`Remove ${getLabel(ref)}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trigger button — anchor for popover (coords tracked via ResizeObserver)
          Style mirrors ScheduleFormModal's "Add description" ghost link pattern:
          no border/background, just dimmed text that brightens on hover. */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleButtonClick}
        className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground)/0.45)] hover:text-[hsl(var(--muted-foreground))] transition-colors"
      >
        <Plus className="w-3 h-3" />
        <span>{t('contextRefs.addContext')}</span>
      </button>

      {/* Popover — rendered via createPortal into document.body so DOM insertion
          never touches the space-y-2 container, preventing button layout jitter. */}
      {open && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            bottom: coords.bottom,
            left: coords.left,
            width: POPOVER_WIDTH,
            zIndex: 9999,
            // Transition (not animation): smoothly interpolates from current value,
            // so mid-exit click reversal is seamless with no jump.
            opacity: isVisible ? 1 : 0,
            transform: `translateY(${isVisible ? 0 : 4}px)`,
            transition: `opacity ${isVisible ? ENTER_MS : EXIT_MS}ms ease-${isVisible ? 'out' : 'in'}, transform ${isVisible ? ENTER_MS : EXIT_MS}ms ease-${isVisible ? 'out' : 'in'}`,
            pointerEvents: isVisible ? 'auto' : 'none',
          }}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-xl overflow-hidden"
        >
          {/* Search input inside the popover */}
          <div className="p-2 border-b border-[hsl(var(--border))]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('contextRefs.searchPlaceholder')}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[hsl(var(--foreground)/0.04)] border border-[hsl(var(--border))] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground)/0.5)] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
              />
            </div>
          </div>

          {/* Results list */}
          <div className="max-h-48 overflow-y-auto">
            {hasResults ? (
              <>
                {filteredIssues.length > 0 && (
                  <div>
                    <div className="px-3 py-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider bg-[hsl(var(--popover))] sticky top-0">
                      {t('contextRefs.issuesWithSession')}
                    </div>
                    {filteredIssues.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        onMouseDown={() => addRef({ type: 'issue', id: issue.id })}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
                      >
                        <Link className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        <span className="flex-1 truncate text-[hsl(var(--foreground))]">{issue.title}</span>
                        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">{issue.status}</span>
                      </button>
                    ))}
                  </div>
                )}

                {filteredArtifacts.length > 0 && (
                  <div>
                    <div className="px-3 py-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider bg-[hsl(var(--popover))] sticky top-0">
                      {t('contextRefs.starredArtifacts')}
                    </div>
                    {filteredArtifacts.map((artifact) => (
                      <button
                        key={artifact.id}
                        type="button"
                        onMouseDown={() => addRef({ type: 'artifact', id: artifact.id })}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
                      >
                        <FileText className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]" />
                        <span className="flex-1 truncate text-[hsl(var(--foreground))]">
                          {artifact.title || artifact.filePath || artifact.id}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">{artifact.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="px-3 py-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
                {search ? t('contextRefs.noMatches') : t('contextRefs.noContextAvailable')}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
