// SPDX-License-Identifier: Apache-2.0

import type { CapabilityEntryBase } from '@shared/types'

/**
 * Extract a searchable text value from a capability entry by field name.
 *
 * Uses runtime `in` guard instead of `as unknown as Record<string, unknown>`
 * double-cast. Returns a lowercased string for case-insensitive comparison.
 *
 * @param entry  - The capability entry to read from
 * @param field  - The field name (from `CategoryConfig.searchFields`)
 * @returns Lowercased string value, or empty string if the field doesn't exist
 */
export function getSearchableText(entry: CapabilityEntryBase, field: string): string {
  if (field in entry) {
    const value = (entry as unknown as Record<string, unknown>)[field]
    return typeof value === 'string' ? value.toLowerCase() : ''
  }
  return ''
}
