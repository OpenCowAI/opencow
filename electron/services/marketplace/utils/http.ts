// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP utilities for marketplace adapters.
 *
 * All marketplace network calls flow through `fetchWithTimeout()`, which
 * uses a module-level `_fetcher` function. By default this is `globalThis.fetch`,
 * but the host application can inject a proxy-aware fetcher via
 * `configureMarketplaceFetch()` — giving ALL adapters automatic proxy support
 * without changing any adapter code.
 *
 * Separated from the adapter base class to follow composition-over-inheritance.
 * Any adapter (or test) can import these directly without inheriting a God class.
 */

import type { MarketplaceSearchResponse } from '../types'

// ─── Configurable fetch ─────────────────────────────────────

/** Default network timeout for marketplace requests (ms). */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Module-level fetch function.
 * Defaults to `globalThis.fetch`; replaced by `configureMarketplaceFetch()`
 * when the host application supplies a proxy-aware implementation.
 */
let _fetcher: typeof globalThis.fetch = globalThis.fetch

/**
 * Inject a custom fetch implementation for ALL marketplace network calls.
 *
 * Called once during app startup (and again when proxy settings change).
 * The injected function is typically `undici.fetch` backed by a `ProxyAgent`,
 * or `globalThis.fetch` when no proxy is configured.
 *
 * Zero adapter changes required — they all go through `fetchWithTimeout()`.
 */
export function configureMarketplaceFetch(fn: typeof globalThis.fetch): void {
  _fetcher = fn
}

/** fetch() with an AbortSignal-based timeout. Respects the injected fetcher. */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await _fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ─── Standard response factories ────────────────────────────
// Eliminates duplicated object literals across every adapter's search().

const EMPTY_RESULTS = { items: [] as never[], total: 0 as const, hasMore: false as const }

/** Canonical rate-limited response — shared by all adapters. */
export const RATE_LIMITED_RESPONSE: MarketplaceSearchResponse = {
  status: { state: 'rate-limited' },
  results: { ...EMPTY_RESULTS },
}

/** Build a standard error response from a caught exception. */
export function searchErrorResponse(err: unknown): MarketplaceSearchResponse {
  const message = err instanceof Error ? err.message : String(err)
  return {
    status: { state: 'error', message },
    results: { ...EMPTY_RESULTS },
  }
}
