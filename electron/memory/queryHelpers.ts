// SPDX-License-Identifier: Apache-2.0

/**
 * Safe helpers for extracting aggregate values from Kysely query results.
 *
 * Replaces brittle `(result as Record<string, unknown>)?.cnt as number ?? 0`
 * patterns with validated extraction.
 */

/** Safely extract a count value from a Kysely aggregate result row. */
export function extractCount(row: unknown, field: string = 'cnt'): number {
  if (!row || typeof row !== 'object') return 0
  const value = (row as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Safely extract an average value from a Kysely aggregate result row. */
export function extractAvg(row: unknown, field: string = 'avg_conf'): number {
  if (!row || typeof row !== 'object') return 0
  const value = (row as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
