// SPDX-License-Identifier: Apache-2.0

import type { CapabilitySource, CapabilityEntryBase } from '@shared/types'

// === Types ===

export interface SourceGroupData<T extends CapabilityEntryBase = CapabilityEntryBase> {
  /** Group key: 'project' | 'user' | 'plugin:superpowers' | 'other' */
  key: string
  /** Display label: 'Project' | 'User' | 'superpowers' | 'Other' */
  label: string
  items: T[]
}

// === Group Key ===

export function deriveGroupKey(source: CapabilitySource): string {
  if (source.scope === 'project') return 'project'
  if (source.origin === 'plugin' && source.mount) return `plugin:${source.mount.name}`
  // Global scope — user, marketplace, etc.
  return 'user'
}

// === Group Priority ===

const FIXED_PRIORITY: Record<string, number> = {
  project: 0,
  user: 1,
  other: 99,
}

function groupSortKey(key: string): [number, string] {
  if (key in FIXED_PRIORITY) return [FIXED_PRIORITY[key], key]
  // plugin:* keys → priority 2, then alphabetical by plugin name
  if (key.startsWith('plugin:')) return [2, key.slice('plugin:'.length)]
  return [98, key]
}

// === Label Derivation ===

function deriveLabel(key: string): string {
  if (key === 'project') return 'Project'
  if (key === 'user') return 'User'
  if (key === 'other') return 'Other'
  if (key.startsWith('plugin:')) return key.slice('plugin:'.length)
  return key
}

// === Main Grouping Function ===

export function groupBySource<T extends CapabilityEntryBase>(items: T[]): SourceGroupData<T>[] {
  // 1. Bucket items by group key
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = deriveGroupKey(item.source)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(key, [item])
    }
  }

  // 2. Convert to SourceGroupData[]
  const groups: SourceGroupData<T>[] = []
  for (const [key, groupItems] of buckets) {
    groups.push({ key, label: deriveLabel(key), items: groupItems })
  }

  // 3. Sort by fixed priority, then alphabetically within same priority
  groups.sort((a, b) => {
    const [pa, sa] = groupSortKey(a.key)
    const [pb, sb] = groupSortKey(b.key)
    return pa !== pb ? pa - pb : sa.localeCompare(sb)
  })

  return groups
}

// === Default Expand State ===

export function defaultExpanded(groupKey: string): boolean {
  return groupKey === 'project' || groupKey === 'user'
}
