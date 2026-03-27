// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '../platform/logger'

const log = createLogger('safeJson')

/**
 * Parse a JSON string with a fallback value on failure.
 *
 * Prevents crashes from corrupted database rows or malformed API responses.
 * Logs a warning on parse failure for debugging.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    log.warn('Failed to parse JSON', {
      error: err instanceof Error ? err.message : String(err),
      input: raw.slice(0, 200),
    })
    return fallback
  }
}

/**
 * Parse a JSON string, returning null on failure instead of throwing.
 */
export function safeJsonParseOrNull<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
