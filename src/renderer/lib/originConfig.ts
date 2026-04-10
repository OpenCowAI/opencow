// SPDX-License-Identifier: Apache-2.0

/**
 * Origin Configuration — Single Source of Truth
 *
 * Centralizes all origin-related display configuration (labels, colors)
 * and the "local" semantics, consumed by both CapabilityCards (badge)
 * and useCapabilityFilters (filter pills).
 *
 * Adding a new `sourceOrigin` value in `types.ts` will cause a TS error
 * in `ORIGIN_REGISTRY` until the corresponding config is provided —
 * preventing silent omission.
 */
import type { CapabilityEntry, CapabilityImportRecord, CapabilitySource } from '@shared/types'

// ── Types ───────────────────────────────────────────────────────────

/** Possible `sourceOrigin` values from the data model. */
export type SourceOrigin = CapabilityImportRecord['sourceOrigin']

/**
 * The resolved origin of a capability entry.
 * 'local' means user-created (no importInfo).
 */
export type ResolvedOrigin = 'local' | SourceOrigin

/** Filter values including the "show all" meta-option. */
export type OriginFilterValue = 'all' | ResolvedOrigin

// ── Origin Registry ─────────────────────────────────────────────────

export interface OriginConfig {
  /** Display label — brand names stay in English across locales. */
  label: string
  /** Badge color class (bg + text) for inline row badges. */
  badgeClass: string
  /** Active-state text color for filter pills. */
  filterActiveClass: string
}

/**
 * Config for each imported origin type.
 *
 * Typed as `Record<SourceOrigin, ...>` to ensure exhaustive coverage —
 * if a new sourceOrigin is added in types.ts, TS will flag the missing key.
 */
export const ORIGIN_REGISTRY: Record<SourceOrigin, OriginConfig> = {
  'claude-code': {
    label: 'Claude Code',
    badgeClass: 'bg-amber-600/10 text-amber-700 dark:text-amber-400',
    filterActiveClass: 'text-amber-600 dark:text-amber-400',
  },
  plugin: {
    label: 'Plugin',
    badgeClass: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
    filterActiveClass: 'text-pink-600 dark:text-pink-400',
  },
  marketplace: {
    label: 'Store',
    badgeClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    filterActiveClass: 'text-violet-600 dark:text-violet-400',
  },
  template: {
    label: 'Template',
    badgeClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    filterActiveClass: 'text-sky-600 dark:text-sky-400',
  },
  file: {
    label: 'Local File',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    filterActiveClass: 'text-emerald-600 dark:text-emerald-400',
  },
  unknown: {
    label: 'Unknown',
    badgeClass: 'bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.7)]',
    filterActiveClass: 'text-[hsl(var(--muted-foreground))]',
  },
}

/** Config for locally-created items (no importInfo). */
export const LOCAL_ORIGIN_CONFIG: OriginConfig = {
  label: 'Custom',
  badgeClass: 'bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.6)]',
  filterActiveClass: 'text-[hsl(var(--foreground))]',
}

// ── Resolvers ───────────────────────────────────────────────────────

/**
 * Resolve the origin of a capability entry from capMap.
 *
 * Centralizes the "local" semantic: a capability is "local" if and only if
 * it has no importInfo (i.e., user-created, not imported from any source).
 */
export function resolveOrigin(
  capMap: ReadonlyMap<string, CapabilityEntry>,
  lookupKey: string,
): ResolvedOrigin {
  const cap = capMap.get(lookupKey)
  return cap?.importInfo?.sourceOrigin ?? 'local'
}

/** Get the display config for any origin value (including 'local'). */
export function getOriginConfig(origin: ResolvedOrigin): OriginConfig {
  if (origin === 'local') return LOCAL_ORIGIN_CONFIG
  return ORIGIN_REGISTRY[origin]
}

/**
 * Derive display-ready sourceOrigin from a CapabilitySource.
 *
 * Maps the universal `CapabilitySource.origin` (directory-level "where found")
 * to `SourceOrigin` (ecosystem-level "where from") for display purposes.
 *
 * Used by `OriginBadge` as fallback when `importInfo` is unavailable
 * (legacy / unmanaged entries that don't go through the import pipeline).
 */
export function deriveSourceOrigin(source: CapabilitySource): SourceOrigin | undefined {
  switch (source.origin) {
    // Plugin entries are discovered from Claude Code installation paths
    case 'plugin':      return 'claude-code'
    case 'marketplace':  return 'marketplace'
    case 'config-file':  return 'file'
    // user / project → no specific import origin → undefined (shows "Custom")
    default:             return undefined
  }
}
