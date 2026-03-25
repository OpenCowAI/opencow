// SPDX-License-Identifier: Apache-2.0

/**
 * Global search hook for the Cmd+K command palette.
 *
 * Orchestrates data from appStore → pure search functions → UI-ready results.
 * Follows the codebase's hook pattern: functional, no class, store via selectors.
 *
 * Responsibilities:
 *   - Build searchable items from store data
 *   - Load frecency map (one localStorage read) and pass to pure search
 *   - Debounce search execution for smooth typing
 *   - Keyboard navigation with ref-based selectedIndex (no stale closure)
 *   - Navigation dispatch on result selection
 *
 * This hook does NOT manage palette open/close — that is the component's concern.
 *
 * @module useGlobalSearch
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Zap } from 'lucide-react'
import { useAppStore, selectProjectId, selectMainTab } from '@/stores/appStore'
import { useIssueStore, selectIssuesArray } from '@/stores/issueStore'
import { selectIssue } from '@/actions/issueActions'
import { useScheduleStore } from '@/stores/scheduleStore'
import { selectSchedule as selectScheduleAction } from '@/actions/scheduleActions'
import { navigateToSession as navigateToSessionAction } from '@/actions/navigationActions'
import type { MainTab } from '@shared/types'
import {
  type SearchResult,
  type SearchResultGroup,
  type SearchableItem,
  type SearchFilterType,
  type SearchFilterCounts,
  SEARCH_SOURCES,
  COMMAND_ACTIONS,
  getLocalizedCommandActions,
  type CommandActionKeywords,
  issueToSearchableItem,
  sessionToSearchableItem,
  scheduleToSearchableItem,
  projectToSearchableItem,
  executeSearch,
  countItemsByType,
  countResultsByType,
  applySearchFilter,
  capGroupsForDisplay,
  type SearchContext,
  type ActionSearchableItem,
} from '@/lib/globalSearch'
import {
  recordFrecencyVisit,
  loadFrecencyScoreMap,
  getTopFrecencyItems,
  type FrecencyScoreMap,
} from '@/lib/frecency'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Debounce delay for search execution (ms). Input display updates immediately. */
const SEARCH_DEBOUNCE_MS = 80

/** Empty array sentinel — avoids re-creating [] on every render. */
const EMPTY_RESULTS: SearchResult[] = []

/* ------------------------------------------------------------------ */
/*  Return type                                                        */
/* ------------------------------------------------------------------ */

export interface UseGlobalSearchReturn {
  /** Current query string (updates immediately on input) */
  query: string
  /** Update query */
  setQuery: (query: string) => void

  /** Grouped search results (after filter applied) */
  groups: SearchResultGroup[]
  /** Flat result list for keyboard navigation (after filter applied) */
  flatItems: SearchResult[]
  /** Whether there are any results */
  hasResults: boolean

  /** Currently selected index in flatItems */
  selectedIndex: number

  /** Active type filter ('all' or a specific entity type) */
  activeFilter: SearchFilterType
  /** Human-readable label for the active filter (e.g. "issues", "sessions") */
  activeFilterLabel: string | null
  /** Update type filter */
  setActiveFilter: (filter: SearchFilterType) => void
  /** Per-type match counts for filter bar badges */
  filterCounts: SearchFilterCounts

  /** Keyboard event handler (attach to input onKeyDown) */
  handleKeyDown: (e: React.KeyboardEvent) => void

  /** Select a result and execute its navigation/action (does NOT close palette) */
  selectResult: (result: SearchResult) => void

  /** Reset search state (call when closing the palette) */
  reset: () => void
}

/* ------------------------------------------------------------------ */
/*  Default results (empty query state)                                */
/* ------------------------------------------------------------------ */

function buildDefaultResults(
  allItems: readonly SearchableItem[],
  frecencyMap: FrecencyScoreMap,
  actions: readonly ActionSearchableItem[] = COMMAND_ACTIONS,
): { groups: SearchResultGroup[]; flatItems: SearchResult[] } {
  const topKeys = getTopFrecencyItems(8, frecencyMap)
  const recentItems: SearchResult[] = []

  for (const key of topKeys) {
    // Key format: "type:entityId"
    const colonIdx = key.indexOf(':')
    if (colonIdx < 0) continue
    const entityId = key.slice(colonIdx + 1)
    const type = key.slice(0, colonIdx)

    const item = allItems.find((i) => i.type === type && i.entityId === entityId)
    if (item) {
      recentItems.push({
        item,
        score: frecencyMap.get(key) ?? 0,
        primaryHighlights: [],
        secondaryHighlights: [],
      })
    }
  }

  const groups: SearchResultGroup[] = []
  const flatItems: SearchResult[] = []

  if (recentItems.length > 0) {
    groups.push({
      type: 'recent',
      label: 'Recent',
      icon: Clock,
      items: recentItems,
    })
    flatItems.push(...recentItems)
  }

  // Quick Actions always shown
  const actionResults = actions.slice(0, 5).map((action) => ({
    item: action,
    score: 0,
    primaryHighlights: [],
    secondaryHighlights: [],
  }))
  groups.push({
    type: 'action',
    label: 'Quick Actions',
    icon: Zap,
    items: actionResults,
  })
  flatItems.push(...actionResults)

  return { groups, flatItems }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useGlobalSearch(): UseGlobalSearchReturn {
  // ── i18n for locale-aware search keywords ──────────
  const { t } = useTranslation('navigation')

  // ── Data from appStore ──────────────────────────────
  const issues = useIssueStore(selectIssuesArray)
  const sessions = useAppStore((s) => s.sessions)
  const schedules = useScheduleStore((s) => s.schedules)
  const projects = useAppStore((s) => s.projects)
  const activeTab = useAppStore(selectMainTab)
  const currentProjectId = useAppStore(selectProjectId)

  // Navigation actions
  const navigateToProject = useAppStore((s) => s.navigateToProject)
  const setMainTab = useAppStore((s) => s.setMainTab)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)

  // ── Local state ─────────────────────────────────────
  const [query, setQueryRaw] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeFilter, setActiveFilterRaw] = useState<SearchFilterType>('all')

  // Debounced query — search executes against this, not the raw `query`
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs for stable closure access in handleKeyDown (avoids stale selectedIndex)
  const listRef = useRef<SearchResult[]>(EMPTY_RESULTS)
  const selectedIndexRef = useRef(0)

  // ── Query setter with built-in debounce ────────────
  // Avoids calling setState inside useEffect (react-hooks/set-state-in-effect).
  const setQuery = useCallback((newQuery: string) => {
    setQueryRaw(newQuery)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

    // Empty query: update immediately (show default results without delay)
    if (!newQuery.trim()) {
      setDebouncedQuery('')
      return
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(newQuery)
    }, SEARCH_DEBOUNCE_MS)
  }, [])

  // ── Search context ──────────────────────────────────
  const context: SearchContext = useMemo(
    () => ({ activeTab, projectId: currentProjectId }),
    [activeTab, currentProjectId],
  )

  // ── Build locale-aware command actions ──────────────
  const localizedActions = useMemo(() => {
    const kw: CommandActionKeywords = {}
    const keys: Record<string, string> = {
      'go-issues': 'commandPalette.goIssues',
      'go-sessions': 'commandPalette.goSessions',
      'go-schedule': 'commandPalette.goSchedule',
      'go-dashboard': 'commandPalette.goDashboard',
      'go-market': 'commandPalette.goMarket',
      'create-issue': 'commandPalette.createIssue',
      'create-schedule': 'commandPalette.createSchedule',
    }
    for (const [actionId, i18nKey] of Object.entries(keys)) {
      const val = t(i18nKey, '')
      if (val) kw[actionId] = val.split(',').map((s) => s.trim()).filter(Boolean)
    }
    return getLocalizedCommandActions(kw)
  }, [t])

  // ── Build searchable items from all data sources ────
  const searchableItems: SearchableItem[] = useMemo(() => [
    ...issues.map(issueToSearchableItem),
    ...sessions.map(sessionToSearchableItem),
    ...schedules.map(scheduleToSearchableItem),
    ...projects.map(projectToSearchableItem),
    ...localizedActions,
  ], [issues, sessions, schedules, projects, localizedActions])

  // ── Load frecency map ───────────────────────────────
  // Loaded once per palette session (this Hook is only mounted while
  // the palette is open, thanks to the CommandPaletteInner split).
  // One localStorage read instead of N reads per item per keystroke.
  const frecencyMap = useMemo(() => loadFrecencyScoreMap(), [])

  // ── Search (single execution, uncapped) ─────────────
  // Groups contain ALL matches. Display capping is a separate concern
  // handled downstream by capGroupsForDisplay.
  const fullResult = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return buildDefaultResults(searchableItems, frecencyMap, localizedActions)
    }
    return executeSearch(searchableItems, debouncedQuery, context, frecencyMap)
  }, [debouncedQuery, searchableItems, context, frecencyMap, localizedActions])

  // ── Filter counts (for badge display) ─────────────
  const filterCounts = useMemo((): SearchFilterCounts => {
    if (!debouncedQuery.trim()) {
      return countItemsByType(searchableItems)
    }
    return countResultsByType(fullResult.groups)
  }, [debouncedQuery, searchableItems, fullResult.groups])

  // ── Filter → Cap for display ──────────────────────
  // Single pipeline: filter by type → cap for rendering.
  // Only depends on fullResult + activeFilter (no re-search needed).
  const { groups, flatItems } = useMemo(() => {
    const filtered = applySearchFilter(fullResult, activeFilter)
    return capGroupsForDisplay(filtered, activeFilter)
  }, [fullResult, activeFilter])

  // Keep refs in sync for stable closure access in handleKeyDown
  useEffect(() => {
    listRef.current = flatItems
  }, [flatItems])

  // ── Reset selection when results change ─────────────
  useEffect(() => {
    setSelectedIndex(0) // eslint-disable-line react-hooks/set-state-in-effect -- reset selection on data change
    selectedIndexRef.current = 0
  }, [flatItems.length])

  // ── Sync selectedIndex to ref ──────────────────────
  // Ensures ref is always up-to-date for handleKeyDown closure
  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  // ── Derive active filter label ─────────────────────
  const activeFilterLabel = activeFilter === 'all'
    ? null
    : SEARCH_SOURCES.find((s) => s.type === activeFilter)?.label.toLowerCase() ?? null

  // ── Filter setter with selection reset ──────────────
  const setActiveFilter = useCallback((filter: SearchFilterType) => {
    setActiveFilterRaw(filter)
    setSelectedIndex(0)
    selectedIndexRef.current = 0
  }, [])

  // ── Action dispatch by actionId ─────────────────────
  const executeAction = useCallback((actionId: string) => {
    switch (actionId) {
      case 'go-issues':
        setMainTab('issues')
        break
      case 'go-sessions':
        setMainTab('chat')
        break
      case 'go-schedule':
        setMainTab('schedule')
        break
      case 'go-dashboard':
        setMainTab('dashboard')
        break
      case 'go-market':
        setMainTab('capabilities' as MainTab)
        break
      case 'create-issue':
        setMainTab('issues')
        break
      case 'create-schedule':
        setMainTab('schedule')
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[useGlobalSearch] Unknown actionId: ${actionId}`)
        }
        break
    }
  }, [setMainTab])

  // ── Select result & navigate ────────────────────────
  // NOTE: This hook does NOT close the palette — the component layer does.
  const selectResult = useCallback((result: SearchResult) => {
    // Record frecency
    recordFrecencyVisit(`${result.item.type}:${result.item.entityId}`)

    // Dispatch navigation based on result type
    switch (result.item.type) {
      case 'issue':
        setMainTab('issues')
        setSearchQuery('')
        selectIssue(result.item.entityId)
        break
      case 'session':
        if (result.item.projectId) {
          setSearchQuery('')
          navigateToSessionAction(result.item.projectId, result.item.entityId)
        }
        break
      case 'schedule':
        setMainTab('schedule')
        selectScheduleAction(result.item.entityId)
        break
      case 'project':
        navigateToProject(result.item.entityId)
        break
      case 'action':
        executeAction(result.item.actionId)
        break
    }
  }, [
    setMainTab, setSearchQuery,
    navigateToProject,
    executeAction,
  ])

  // ── Keyboard navigation ─────────────────────────────
  // Uses refs for items + selectedIndex to avoid stale closure on rapid keystrokes
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = listRef.current
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.min(i + 1, items.length - 1)
          selectedIndexRef.current = next
          return next
        })
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => {
          const next = Math.max(i - 1, 0)
          selectedIndexRef.current = next
          return next
        })
        break
      case 'Enter':
        e.preventDefault()
        if (items[selectedIndexRef.current]) {
          selectResult(items[selectedIndexRef.current])
        }
        break
    }
  }, [selectResult])

  // ── Reset ───────────────────────────────────────────
  const reset = useCallback(() => {
    setQueryRaw('')
    setDebouncedQuery('')
    setSelectedIndex(0)
    selectedIndexRef.current = 0
    setActiveFilterRaw('all')
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
  }, [])

  return {
    query,
    setQuery,
    groups,
    flatItems,
    hasResults: flatItems.length > 0,
    selectedIndex,
    activeFilter,
    activeFilterLabel,
    setActiveFilter,
    filterCounts,
    handleKeyDown,
    selectResult,
    reset,
  }
}
