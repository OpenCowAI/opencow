// SPDX-License-Identifier: Apache-2.0

import type { ProviderStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface QueryProviderStatusInput {
  force?: boolean
  maxAgeMs?: number
}

export interface PrimeProviderStatusCacheInput {
  status: ProviderStatus | null
}

let inFlightQuery: Promise<ProviderStatus> | null = null
let cachedStatus: ProviderStatus | null = null
let cachedAt: number | null = null

const DEFAULT_CACHE_MAX_AGE_MS = 15_000

function hasFreshCache(maxAgeMs: number): boolean {
  if (!cachedStatus || typeof cachedAt !== 'number') return false
  return Date.now() - cachedAt <= maxAgeMs
}

/**
 * Query provider status with single-flight de-duplication.
 *
 * - Concurrent callers share one IPC request.
 * - Cached result is returned unless `force` is set.
 */
export function queryProviderStatus(
  { force = false, maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS }: QueryProviderStatusInput = {},
): Promise<ProviderStatus> {
  if (!force && hasFreshCache(maxAgeMs) && cachedStatus) {
    return Promise.resolve(cachedStatus)
  }

  if (inFlightQuery) return inFlightQuery

  const request = getAppAPI()['provider:get-status']()
    .then((status) => {
      cachedStatus = status
      cachedAt = Date.now()
      return status
    })
    .finally(() => {
      inFlightQuery = null
    })

  inFlightQuery = request
  return request
}

/**
 * Prime or clear cache entry based on the latest known status.
 */
export function primeProviderStatusCache({ status }: PrimeProviderStatusCacheInput): void {
  if (!status) {
    cachedStatus = null
    cachedAt = null
    return
  }
  cachedStatus = status
  cachedAt = Date.now()
}

export function clearProviderStatusCache(): void {
  cachedStatus = null
  cachedAt = null
}
