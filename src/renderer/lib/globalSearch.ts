// SPDX-License-Identifier: Apache-2.0

/**
 * Global search engine — pure functions for Cmd+K command palette.
 *
 * This module contains:
 * - SearchableItem discriminated union types
 * - SEARCH_SOURCES static config
 * - COMMAND_ACTIONS static registry
 * - Entity → SearchableItem conversion functions
 * - Scoring, matching, grouping pure functions
 *
 * All functions are pure (no side effects, no store access).
 * Frecency data is passed in as an immutable Map by the caller.
 *
 * @module globalSearch
 */

import type { LucideIcon } from 'lucide-react'
import {
  CircleDot,
  MessageSquare,
  Clock,
  FolderGit2,
  Zap,
} from 'lucide-react'
import type {
  IssueSummary,
  IssueStatus,
  IssuePriority,
  Session,
  SessionStatus,
  Schedule,
  ScheduleStatus,
  SchedulePriority,
  Project,
  MainTab,
} from '@shared/types'
import { fuzzyMatch, type FuzzyMatchResult } from '@shared/fileSearch'
import type { FrecencyScoreMap } from '@/lib/frecency'

/* ================================================================== */
/*  SearchableItem — Discriminated Union                               */
/* ================================================================== */

interface SearchableItemBase {
  /** Entity unique ID */
  entityId: string
  /** Primary searchable text (title / name) */
  primary: string
  /** Secondary searchable text (description / path / cwd), lower weight */
  secondary: string
  /** Keyword aliases (labels, git branch) — participate in matching, not displayed */
  keywords: string[]
  /** Owning project ID (for context boost), null = global */
  projectId: string | null
  /** Last update / activity timestamp (for tie-breaking) */
  updatedAt: number
}

export interface IssueSearchableItem extends SearchableItemBase {
  type: 'issue'
  status: IssueStatus
  priority: IssuePriority
  labels: string[]
  hasSession: boolean
}

export interface SessionSearchableItem extends SearchableItemBase {
  type: 'session'
  sessionStatus: SessionStatus
  gitBranch: string | null
  lastActivity: number
}

export interface ScheduleSearchableItem extends SearchableItemBase {
  type: 'schedule'
  scheduleStatus: ScheduleStatus
  schedulePriority: SchedulePriority
  nextRunAt: number | null
  frequencySummary: string
}

export interface ProjectSearchableItem extends SearchableItemBase {
  type: 'project'
  isPinned: boolean
}

export interface ActionSearchableItem extends SearchableItemBase {
  type: 'action'
  category: 'navigation' | 'creation'
  shortcut: string | null
  actionId: string
}

export type SearchableItem =
  | IssueSearchableItem
  | SessionSearchableItem
  | ScheduleSearchableItem
  | ProjectSearchableItem
  | ActionSearchableItem

/* ================================================================== */
/*  SearchResult — Scored result with highlights                       */
/* ================================================================== */

export interface SearchResult {
  item: SearchableItem
  score: number
  primaryHighlights: number[]
  secondaryHighlights: number[]
}

/** Group type includes entity types plus synthetic groups (e.g. "recent"). */
export type SearchResultGroupType = SearchableItem['type'] | 'recent'

export interface SearchResultGroup {
  type: SearchResultGroupType
  label: string
  icon: LucideIcon
  /** All matched items (uncapped). Display layer handles truncation via capGroupsForDisplay. */
  items: SearchResult[]
}

/* ================================================================== */
/*  SearchSourceConfig — Static source configuration                   */
/* ================================================================== */

export interface SearchSourceConfig {
  type: SearchableItem['type']
  label: string
  icon: LucideIcon
  maxResults: number
  /** Display order — lower = higher in the list */
  displayOrder: number
  weights: {
    primary: number
    secondary: number
    keywordBonus: number
  }
}

export const SEARCH_SOURCES: readonly SearchSourceConfig[] = [
  {
    type: 'issue',
    label: 'Issues',
    icon: CircleDot,
    maxResults: 5,
    displayOrder: 10,
    weights: { primary: 1.0, secondary: 0.3, keywordBonus: 5 },
  },
  {
    type: 'session',
    label: 'Sessions',
    icon: MessageSquare,
    maxResults: 5,
    displayOrder: 20,
    weights: { primary: 1.0, secondary: 0.5, keywordBonus: 3 },
  },
  {
    type: 'schedule',
    label: 'Schedules',
    icon: Clock,
    maxResults: 5,
    displayOrder: 30,
    weights: { primary: 1.0, secondary: 0.3, keywordBonus: 3 },
  },
  {
    type: 'project',
    label: 'Projects',
    icon: FolderGit2,
    maxResults: 5,
    displayOrder: 40,
    weights: { primary: 1.0, secondary: 0.5, keywordBonus: 0 },
  },
  {
    type: 'action',
    label: 'Actions',
    icon: Zap,
    maxResults: 5,
    displayOrder: 50,
    weights: { primary: 1.0, secondary: 0.3, keywordBonus: 8 },
  },
]

/** Pre-built config lookup — O(1) per item instead of O(N) linear scan. */
const CONFIG_BY_TYPE = new Map<SearchableItem['type'], SearchSourceConfig>(
  SEARCH_SOURCES.map((c) => [c.type, c]),
)

/* ================================================================== */
/*  COMMAND_ACTIONS — Static quick-action registry                     */
/* ================================================================== */

/**
 * Base command action definitions with locale-independent keywords.
 * Locale-specific search aliases are loaded from i18n via `getLocalizedCommandActions()`.
 */
const COMMAND_ACTIONS_BASE: ActionSearchableItem[] = [
  // Navigation
  {
    type: 'action', entityId: 'action:go-issues', actionId: 'go-issues',
    primary: 'Go to Issues', secondary: '', keywords: ['issues', 'tasks'],
    category: 'navigation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
  {
    type: 'action', entityId: 'action:go-sessions', actionId: 'go-sessions',
    primary: 'Go to Sessions', secondary: '', keywords: ['sessions', 'chat', 'conversations'],
    category: 'navigation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
  {
    type: 'action', entityId: 'action:go-schedule', actionId: 'go-schedule',
    primary: 'Go to Schedule', secondary: '', keywords: ['schedule', 'cron', 'automation'],
    category: 'navigation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
  {
    type: 'action', entityId: 'action:go-dashboard', actionId: 'go-dashboard',
    primary: 'Go to Dashboard', secondary: '', keywords: ['dashboard', 'home', 'overview'],
    category: 'navigation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
  {
    type: 'action', entityId: 'action:go-market', actionId: 'go-market',
    primary: 'Go to Marketplace', secondary: '', keywords: ['market', 'marketplace', 'skills', 'store'],
    category: 'navigation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
  // Creation
  {
    type: 'action', entityId: 'action:create-issue', actionId: 'create-issue',
    primary: 'Create Issue', secondary: '', keywords: ['new issue', 'create', 'add'],
    category: 'creation', shortcut: '⌘N',
    projectId: null, updatedAt: 0,
  },
  {
    type: 'action', entityId: 'action:create-schedule', actionId: 'create-schedule',
    primary: 'Create Schedule', secondary: '', keywords: ['new schedule', 'add', 'create'],
    category: 'creation', shortcut: null,
    projectId: null, updatedAt: 0,
  },
]

/** Fallback export for backward compatibility. Use `getLocalizedCommandActions()` when i18n is available. */
export const COMMAND_ACTIONS: ActionSearchableItem[] = COMMAND_ACTIONS_BASE

/**
 * Locale-aware keyword map keyed by actionId.
 * Callers pass translated keywords (from i18n `navigation.commandPalette.*`) to enrich search.
 */
export type CommandActionKeywords = Partial<Record<string, string[]>>

/**
 * Build command actions enriched with locale-specific search keywords.
 * This allows users to search the command palette in their preferred language
 * without hardcoding locale strings in source code.
 */
export function getLocalizedCommandActions(localeKeywords: CommandActionKeywords): ActionSearchableItem[] {
  return COMMAND_ACTIONS_BASE.map((action) => {
    const extra = localeKeywords[action.actionId]
    if (!extra || extra.length === 0) return action
    return { ...action, keywords: [...action.keywords, ...extra] }
  })
}

/* ================================================================== */
/*  Entity → SearchableItem conversion (pure functions)                */
/* ================================================================== */

export function issueToSearchableItem(issue: IssueSummary): IssueSearchableItem {
  return {
    type: 'issue',
    entityId: issue.id,
    primary: issue.title,
    secondary: '',
    keywords: issue.labels,
    projectId: issue.projectId,
    updatedAt: issue.updatedAt,
    status: issue.status,
    priority: issue.priority,
    labels: issue.labels,
    hasSession: issue.sessionId !== null,
  }
}

export function sessionToSearchableItem(session: Session): SessionSearchableItem {
  return {
    type: 'session',
    entityId: session.id,
    primary: session.name,
    secondary: session.cwd,
    keywords: session.gitBranch ? [session.gitBranch] : [],
    projectId: session.projectId,
    updatedAt: session.lastActivity,
    sessionStatus: session.status,
    gitBranch: session.gitBranch,
    lastActivity: session.lastActivity,
  }
}

export function scheduleToSearchableItem(schedule: Schedule): ScheduleSearchableItem {
  // Build a simple frequency summary inline (avoid depending on i18n in pure module)
  const freq = schedule.trigger.time
  let summary = ''
  if (freq) {
    switch (freq.type) {
      case 'once': summary = 'Once'; break
      case 'interval': {
        const mins = freq.intervalMinutes ?? 0
        if (mins >= 1440) summary = `Every ${Math.round(mins / 1440)}d`
        else if (mins >= 60) summary = `Every ${Math.round(mins / 60)}h`
        else summary = `Every ${mins}m`
        break
      }
      case 'daily': summary = 'Daily'; break
      case 'weekly': summary = 'Weekly'; break
      case 'biweekly': summary = 'Biweekly'; break
      case 'monthly': summary = 'Monthly'; break
      case 'cron': summary = freq.cronExpression ?? 'Cron'; break
    }
    if (freq.timeOfDay && ['daily', 'weekly', 'biweekly', 'monthly'].includes(freq.type)) {
      summary += ` @ ${freq.timeOfDay}`
    }
  } else if (schedule.trigger.event) {
    summary = `On ${schedule.trigger.event.matcherType}`
  }

  return {
    type: 'schedule',
    entityId: schedule.id,
    primary: schedule.name,
    secondary: schedule.description,
    keywords: [schedule.action.type],
    projectId: schedule.projectId,
    updatedAt: schedule.updatedAt,
    scheduleStatus: schedule.status,
    schedulePriority: schedule.priority,
    nextRunAt: schedule.nextRunAt,
    frequencySummary: summary,
  }
}

export function projectToSearchableItem(project: Project): ProjectSearchableItem {
  return {
    type: 'project',
    entityId: project.id,
    primary: project.name,
    secondary: project.path,
    keywords: [],
    projectId: null,
    updatedAt: project.updatedAt,
    isPinned: project.pinOrder !== null,
  }
}

/* ================================================================== */
/*  Scoring (pure function)                                            */
/* ================================================================== */

interface ScoreParams {
  primaryFuzzyScore: number
  secondaryFuzzyScore: number
  keywordMatched: boolean
  weights: SearchSourceConfig['weights']
  context: {
    tabBoost: number
    projectBoost: number
  }
  frecencyScore: number
}

/**
 * Composite score: weightedFuzzy × contextBoost × frecencyBoost + bonuses
 */
export function computeScore(params: ScoreParams): number {
  const {
    primaryFuzzyScore,
    secondaryFuzzyScore,
    keywordMatched,
    weights,
    context,
    frecencyScore,
  } = params

  const weightedFuzzy =
    primaryFuzzyScore * weights.primary +
    secondaryFuzzyScore * weights.secondary

  const contextBoost = context.tabBoost * context.projectBoost
  const frecencyBoost = 1.0 + Math.min(frecencyScore, 2.0)
  const keywordBonus = keywordMatched ? weights.keywordBonus : 0

  return weightedFuzzy * contextBoost * frecencyBoost + keywordBonus
}

/* ================================================================== */
/*  Context helpers                                                    */
/* ================================================================== */

/** Map active tab → item type for contextual tab boost */
const TAB_TO_ITEM_TYPE: Partial<Record<MainTab, SearchableItem['type']>> = {
  issues: 'issue',
  chat: 'session',
  schedule: 'schedule',
}

export function resolveTabBoost(
  activeTab: MainTab | null,
  itemType: SearchableItem['type'],
): number {
  if (activeTab && TAB_TO_ITEM_TYPE[activeTab] === itemType) return 1.5
  return 1.0
}

/* ================================================================== */
/*  Search execution (pure function)                                   */
/* ================================================================== */

export interface SearchContext {
  activeTab: MainTab | null
  projectId: string | null
}

/**
 * Execute search across all items.
 * Pure function — no side effects, no store access.
 *
 * @param items        - All searchable items (pre-built from store data)
 * @param query        - Raw user query string
 * @param context      - Current UI context for relevance boosting
 * @param frecencyMap  - Pre-loaded frecency scores (one localStorage read upstream)
 * @param configs      - Source configs (defaults to SEARCH_SOURCES)
 * @returns Grouped and sorted results
 */
export function executeSearch(
  items: readonly SearchableItem[],
  query: string,
  context: SearchContext,
  frecencyMap: FrecencyScoreMap,
  configs: readonly SearchSourceConfig[] = SEARCH_SOURCES,
): { groups: SearchResultGroup[]; flatItems: SearchResult[] } {
  const q = query.trim()
  if (!q) return { groups: [], flatItems: [] }

  const qLower = q.toLowerCase()

  // 1. Score all items
  const scored: SearchResult[] = []

  for (const item of items) {
    const config = CONFIG_BY_TYPE.get(item.type)
    if (!config) continue

    const primaryMatch: FuzzyMatchResult | null = item.primary
      ? fuzzyMatch(item.primary, q)
      : null
    const secondaryMatch: FuzzyMatchResult | null = item.secondary
      ? fuzzyMatch(item.secondary, q)
      : null
    const keywordMatched = item.keywords.some((kw) =>
      kw.toLowerCase().includes(qLower),
    )

    // At least one match required
    if (!primaryMatch && !secondaryMatch && !keywordMatched) continue

    const score = computeScore({
      primaryFuzzyScore: primaryMatch?.score ?? 0,
      secondaryFuzzyScore: secondaryMatch?.score ?? 0,
      keywordMatched,
      weights: config.weights,
      context: {
        tabBoost: resolveTabBoost(context.activeTab, item.type),
        projectBoost: item.projectId === context.projectId && context.projectId !== null
          ? 1.3
          : 1.0,
      },
      frecencyScore: frecencyMap.get(`${item.type}:${item.entityId}`) ?? 0,
    })

    scored.push({
      item,
      score,
      primaryHighlights: primaryMatch?.highlights ?? [],
      secondaryHighlights: secondaryMatch?.highlights ?? [],
    })
  }

  // 2. Group and sort
  return groupAndSort(scored, configs)
}

/**
 * Group scored results by source type and sort by display order.
 *
 * Returns ALL matched items in each group (no truncation).
 * The display layer calls `capGroupsForDisplay` to truncate for rendering.
 */
export function groupAndSort(
  results: SearchResult[],
  configs: readonly SearchSourceConfig[],
): { groups: SearchResultGroup[]; flatItems: SearchResult[] } {
  // Sort all results by score descending, then by updatedAt descending for ties
  const sorted = [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return b.item.updatedAt - a.item.updatedAt
  })

  // Group by type
  const groupMap = new Map<SearchableItem['type'], SearchResult[]>()
  for (const result of sorted) {
    const group = groupMap.get(result.item.type) ?? []
    group.push(result)
    groupMap.set(result.item.type, group)
  }

  // Build groups in displayOrder
  const groups: SearchResultGroup[] = []
  const flatItems: SearchResult[] = []

  const sortedConfigs = [...configs].sort((a, b) => a.displayOrder - b.displayOrder)
  for (const config of sortedConfigs) {
    const items = groupMap.get(config.type)
    if (!items || items.length === 0) continue

    groups.push({
      type: config.type,
      label: config.label,
      icon: config.icon,
      items,
    })
    flatItems.push(...items)
  }

  return { groups, flatItems }
}

/* ================================================================== */
/*  Search Filter Types & Utilities                                    */
/* ================================================================== */

/** Filter type for the command palette filter bar. 'all' shows all types. */
export type SearchFilterType = 'all' | SearchableItem['type']

/** Per-type match counts for filter bar badges. */
export type SearchFilterCounts = Readonly<Record<SearchableItem['type'], number>>

/**
 * Count searchable items by type (for empty-query default state).
 * Returns a count for every entity type in the discriminated union.
 */
export function countItemsByType(
  items: readonly SearchableItem[],
): SearchFilterCounts {
  const counts = { issue: 0, session: 0, schedule: 0, project: 0, action: 0 }
  for (const item of items) {
    counts[item.type]++
  }
  return counts
}

/**
 * Count matched results by type from grouped search results.
 * Uses `items.length` for entity groups (groups are uncapped),
 * and counts individual items in synthetic groups (e.g. "recent").
 */
export function countResultsByType(
  groups: readonly SearchResultGroup[],
): SearchFilterCounts {
  const counts = { issue: 0, session: 0, schedule: 0, project: 0, action: 0 }
  for (const group of groups) {
    if (group.type === 'recent') {
      // Recent group contains mixed-type items — count individually
      for (const result of group.items) {
        counts[result.item.type]++
      }
    } else {
      // TS narrows group.type to Exclude<SearchResultGroupType, 'recent'> = SearchableItem['type']
      counts[group.type] = group.items.length
    }
  }
  return counts
}

/**
 * Apply type filter to grouped search results.
 *
 * - 'all' → passthrough (no filtering)
 * - specific type → keep only groups of that type; filter "recent" items by type
 *
 * Returns new arrays; does not mutate the input.
 */
export function applySearchFilter(
  result: { groups: SearchResultGroup[]; flatItems: SearchResult[] },
  filter: SearchFilterType,
): { groups: SearchResultGroup[]; flatItems: SearchResult[] } {
  if (filter === 'all') return result

  const groups: SearchResultGroup[] = []

  for (const group of result.groups) {
    if (group.type === 'recent') {
      // Filter mixed-type "recent" items to only the matching type
      const filtered = group.items.filter((r) => r.item.type === filter)
      if (filtered.length > 0) {
        groups.push({ ...group, items: filtered })
      }
    } else if (group.type === filter) {
      groups.push(group)
    }
    // Other entity types and synthetic groups are excluded
  }

  const flatItems = groups.flatMap((g) => g.items)
  return { groups, flatItems }
}

/* ================================================================== */
/*  Display Capping                                                    */
/* ================================================================== */

/**
 * Display-cap lookup keyed by group type (string key avoids `as` casts).
 * Synthetic groups (e.g. "recent") are absent → fallback to Infinity (no cap).
 */
const DISPLAY_CAP_BY_TYPE = new Map<string, number>(
  SEARCH_SOURCES.map((c) => [c.type, c.maxResults]),
)

/** Boosted display cap when a specific type filter is active. */
const FOCUSED_DISPLAY_CAP = 20

/**
 * Cap group items for display.
 *
 * - "all" view → each entity group uses its configured `maxResults` cap.
 * - Filtered view → the focused type uses `FOCUSED_DISPLAY_CAP` (20).
 * - Synthetic groups (e.g. "recent") → no cap (items are already bounded upstream).
 */
export function capGroupsForDisplay(
  result: { groups: SearchResultGroup[]; flatItems: SearchResult[] },
  activeFilter: SearchFilterType,
): { groups: SearchResultGroup[]; flatItems: SearchResult[] } {
  const groups = result.groups.map((group) => {
    const cap = (activeFilter !== 'all' && group.type === activeFilter)
      ? FOCUSED_DISPLAY_CAP
      : DISPLAY_CAP_BY_TYPE.get(group.type) ?? Infinity

    return group.items.length <= cap
      ? group
      : { ...group, items: group.items.slice(0, cap) }
  })

  const flatItems = groups.flatMap((g) => g.items)
  return { groups, flatItems }
}
