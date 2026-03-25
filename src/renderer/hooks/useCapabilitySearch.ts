// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import type { CapabilityEntryBase } from '@shared/types'
import {
  CATEGORY_REGISTRY,
  CATEGORY_GROUPS,
  type CategoryConfig,
  type CategoryGroupConfig,
} from '@/components/ChatView/categoryRegistry'
import { getSearchableText } from '@/lib/searchUtils'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** A single category with its matched items. */
export interface SearchCategoryResult {
  config: CategoryConfig
  items: CapabilityEntryBase[]
}

/** A group of categories with their matched items. */
export interface SearchGroupResult {
  group: CategoryGroupConfig
  categories: SearchCategoryResult[]
}

/** Flat item for keyboard navigation — includes category context. */
export interface SearchFlatItem {
  config: CategoryConfig
  entry: CapabilityEntryBase
  /** Pre-computed index in the flat list (for keyboard navigation). */
  index: number
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_PER_CATEGORY = 5

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Cross-category search over pre-computed entries.
 *
 * Receives `entriesByCategory` — the **already-flattened** per-category data
 * that the parent owns. This hook adds search filtering + grouping on top.
 * No duplicate `flattenSnapshot` call; single source of truth.
 */
export function useCapabilitySearch(
  query: string,
  entriesByCategory: Record<string, CapabilityEntryBase[]>,
): {
  /** Grouped results for rendering section headers. */
  grouped: SearchGroupResult[]
  /** Flat list for keyboard navigation (ArrowUp/ArrowDown). */
  flatItems: SearchFlatItem[]
  /** Whether we have any results at all. */
  hasResults: boolean
} {
  const q = query.toLowerCase().trim()

  const grouped = useMemo(() => {
    if (!q) return []

    const result: SearchGroupResult[] = []

    for (const group of CATEGORY_GROUPS) {
      const categories: SearchCategoryResult[] = []

      for (const config of CATEGORY_REGISTRY) {
        if (config.group !== group.id) continue

        const allItems = entriesByCategory[config.id] ?? []

        // Multi-field search via type-safe helper
        const matched = allItems.filter((entry) =>
          config.searchFields.some((field) =>
            getSearchableText(entry, field).includes(q),
          ),
        )

        if (matched.length > 0) {
          categories.push({
            config,
            items: matched.slice(0, MAX_PER_CATEGORY),
          })
        }
      }

      if (categories.length > 0) {
        result.push({ group, categories })
      }
    }

    return result
  }, [q, entriesByCategory])

  const flatItems = useMemo(() => {
    const items: SearchFlatItem[] = []
    for (const group of grouped) {
      for (const cat of group.categories) {
        for (const entry of cat.items) {
          items.push({ config: cat.config, entry, index: items.length })
        }
      }
    }
    return items
  }, [grouped])

  const hasResults = flatItems.length > 0

  return { grouped, flatItems, hasResults }
}
