// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind, CapabilityScope, CapabilityOrigin } from './types'

/** Slash command item category */
export type SlashItemCategory = 'builtin' | 'command' | 'skill'
export type SlashGroupCategory = SlashItemCategory | 'apps'

export interface SlashItemPresentation {
  /** UI variant for slash surfaces (list row, popover row, etc.) */
  variant: 'default' | 'app'
  /** Display title for UI (does not affect slash mention payload) */
  title?: string
  /** Secondary text displayed under title for rich rows */
  subtitle?: string
  /** Avatar URL for app rows */
  avatarUrl?: string
}

export interface SlashItemExecutionMeta {
  /** Provider hint for execution telemetry/routing */
  provider?: 'evose'
  /** Optional app-level execution info */
  app?: {
    id: string
    type: 'agent' | 'workflow'
    gatewayTool: 'evose_run_agent' | 'evose_run_workflow'
  }
}

/** A single slash command item */
export interface SlashItem {
  id: string
  name: string
  description: string
  argumentHint?: string
  category: SlashItemCategory
  order: number
  /** Capability origin scope. Undefined for built-in commands. */
  scope?: CapabilityScope
  /** Capability origin type. Undefined for built-in commands. */
  origin?: CapabilityOrigin
  /** Absolute path to the .md source file. Undefined for built-in commands. */
  sourcePath?: string
  /** Presentation hints for slash UI (does not affect slash protocol payload). */
  presentation?: SlashItemPresentation
  /** Execution metadata for advanced UX/telemetry. */
  executionMeta?: SlashItemExecutionMeta
}

/** A group of slash items by category */
export interface SlashItemGroup {
  category: SlashGroupCategory
  label: string
  items: SlashItem[]
}

/** Claude-oriented pass-through built-in commands (curated safe subset). */
const CLAUDE_BUILTIN_SLASH_COMMANDS: SlashItem[] = [
  { id: 'builtin:compact', name: 'compact', description: 'Compress conversation context', category: 'builtin', order: 1, argumentHint: '[instructions]' },
  { id: 'builtin:help', name: 'help', description: 'Get usage help', category: 'builtin', order: 2 },
  { id: 'builtin:status', name: 'status', description: 'Show version, model, account info', category: 'builtin', order: 3 },
  { id: 'builtin:cost', name: 'cost', description: 'Show token usage statistics', category: 'builtin', order: 4 },
  { id: 'builtin:usage', name: 'usage', description: 'Show plan usage and rate limits', category: 'builtin', order: 5 },
  { id: 'builtin:plan', name: 'plan', description: 'Enter plan mode', category: 'builtin', order: 6 },
]

/** Engine-scoped pass-through built-in manifest. */
export const BUILTIN_SLASH_COMMANDS_BY_ENGINE: Record<AIEngineKind, SlashItem[]> = {
  claude: CLAUDE_BUILTIN_SLASH_COMMANDS,
}

/**
 * Backward-compatible default builtin list.
 *
 * Existing callers/tests that are not engine-aware still receive Claude's
 * pass-through builtin set.
 */
export const BUILTIN_SLASH_COMMANDS: SlashItem[] = BUILTIN_SLASH_COMMANDS_BY_ENGINE.claude

export function getBuiltinSlashCommands(engineKind: AIEngineKind): SlashItem[] {
  return BUILTIN_SLASH_COMMANDS_BY_ENGINE[engineKind] ?? BUILTIN_SLASH_COMMANDS
}

const CATEGORY_ORDER: SlashGroupCategory[] = ['builtin', 'command', 'skill', 'apps']
const CATEGORY_LABELS: Record<SlashGroupCategory, string> = {
  builtin: 'Built-in',
  command: 'Commands',
  skill: 'Skills',
  apps: 'Apps',
}

/**
 * Score a slash item against a list of query tokens.
 * Returns -1 if any token fails to match (AND logic: all tokens must match).
 * Higher scores indicate better relevance.
 */
function scoreSlashItem(item: SlashItem, tokens: string[]): number {
  const name = item.name.toLowerCase()
  const desc = item.description.toLowerCase()
  const title = item.presentation?.title?.toLowerCase() ?? ''
  const subtitle = item.presentation?.subtitle?.toLowerCase() ?? ''
  const appId = item.executionMeta?.app?.id?.toLowerCase() ?? ''
  let score = 0

  for (const token of tokens) {
    const inName = name.includes(token)
    const inDesc = desc.includes(token)
    const inTitle = title.includes(token)
    const inSubtitle = subtitle.includes(token)
    const inAppId = appId.includes(token)

    // Every token must appear in at least one searchable field.
    if (!inName && !inDesc && !inTitle && !inSubtitle && !inAppId) return -1

    // Score by match quality (name matches are weighted higher)
    if (name === token) score += 100            // exact name match
    else if (name.startsWith(token)) score += 50 // name prefix match
    else if (inName) score += 30                 // name substring match

    if (inDesc) score += 10                      // description match (additive)
    if (title === token) score += 120
    else if (title.startsWith(token)) score += 60
    else if (inTitle) score += 35
    if (inSubtitle) score += 12
    if (appId === token) score += 80
    else if (appId.startsWith(token)) score += 40
    else if (inAppId) score += 20
  }

  return score
}

/**
 * Filter slash items by query with multi-keyword matching and relevance scoring.
 *
 * - Splits the query into whitespace-separated tokens.
 * - All tokens must match (AND logic) against searchable fields
 *   (name/description/presentation/app-id, case-insensitive).
 * - Results are sorted by relevance score (descending).
 */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  if (!query) return items
  const q = query.toLowerCase().trim()
  if (!q) return items

  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return items

  return items
    .map((item) => ({ item, score: scoreSlashItem(item, tokens) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
}

/** Scope sort weight: project first, global second, undefined (builtin) last */
const SCOPE_WEIGHT: Record<string, number> = { project: 0, global: 1 }

function scopeOrder(scope?: CapabilityScope): number {
  return scope ? (SCOPE_WEIGHT[scope] ?? 2) : 2
}

function isAppSlashItem(item: SlashItem): boolean {
  return item.category === 'skill' && item.presentation?.variant === 'app'
}

/**
 * Group slash items by category, omitting empty groups.
 *
 * @param preserveOrder - When true, items within each group keep their input
 *   order (useful when the input is already sorted by relevance from filtering).
 *   When false (default), items are sorted by scope (project → global) then order.
 */
export function groupSlashItems(items: SlashItem[], preserveOrder = false): SlashItemGroup[] {
  const groups: SlashItemGroup[] = []

  for (const cat of CATEGORY_ORDER) {
    let catItems: SlashItem[]
    if (cat === 'apps') {
      catItems = items.filter(isAppSlashItem)
    } else if (cat === 'skill') {
      catItems = items.filter((item) => item.category === 'skill' && !isAppSlashItem(item))
    } else {
      catItems = items.filter((item) => item.category === cat)
    }

    if (!preserveOrder) {
      catItems.sort((a, b) => scopeOrder(a.scope) - scopeOrder(b.scope) || a.order - b.order)
    }
    if (catItems.length > 0) {
      groups.push({ category: cat, label: CATEGORY_LABELS[cat], items: catItems })
    }
  }
  return groups
}

/**
 * Deduplicate slash items by name using first-seen-wins.
 *
 * Callers are responsible for ordering the input by priority
 * (builtins first, then priority-ordered commands, then skills).
 */
export function deduplicateByName(items: SlashItem[]): SlashItem[] {
  const seen = new Set<string>()
  const result: SlashItem[] = []
  for (const item of items) {
    if (!seen.has(item.name)) {
      seen.add(item.name)
      result.push(item)
    }
  }
  return result
}
