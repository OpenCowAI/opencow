// SPDX-License-Identifier: Apache-2.0

import type { IMConnectionStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface QueryMessagingConnectionStatusesInput {
  force?: boolean
  maxAgeMs?: number
}

export interface PrimeMessagingConnectionStatusesCacheInput {
  statuses: IMConnectionStatus[]
}

export interface PrimeMessagingConnectionStatusCacheInput {
  status: IMConnectionStatus
}

let cachedStatuses: IMConnectionStatus[] | null = null
let cachedAtMs: number | null = null
let inFlightQuery: Promise<IMConnectionStatus[]> | null = null

const DEFAULT_CACHE_MAX_AGE_MS = 15_000

function hasFreshCache(maxAgeMs: number): boolean {
  if (!cachedStatuses || cachedAtMs === null) return false
  return Date.now() - cachedAtMs <= maxAgeMs
}

/**
 * Query messaging runtime statuses with single-flight de-duplication and in-memory cache.
 *
 * - Concurrent callers share one IPC request.
 * - Subsequent callers reuse cached results until `force` is set.
 */
export function queryMessagingConnectionStatuses(
  { force = false, maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS }: QueryMessagingConnectionStatusesInput = {},
): Promise<IMConnectionStatus[]> {
  if (!force && hasFreshCache(maxAgeMs)) return Promise.resolve(cachedStatuses!)
  if (inFlightQuery) return inFlightQuery

  inFlightQuery = getAppAPI()['messaging:get-all-statuses']()
    .then((statuses) => {
      cachedStatuses = statuses
      cachedAtMs = Date.now()
      return statuses
    })
    .finally(() => {
      inFlightQuery = null
    })

  return inFlightQuery
}

/**
 * Replace cache with a complete snapshot (typically from store writes).
 */
export function primeMessagingConnectionStatusesCache(
  { statuses }: PrimeMessagingConnectionStatusesCacheInput,
): void {
  cachedStatuses = [...statuses]
  cachedAtMs = Date.now()
}

/**
 * Upsert one connection status into cache (typically from DataBus updates).
 */
export function primeMessagingConnectionStatusCache(
  { status }: PrimeMessagingConnectionStatusCacheInput,
): void {
  const current = cachedStatuses ?? []
  const next = new Map(current.map((item) => [item.connectionId, item]))
  next.set(status.connectionId, status)
  cachedStatuses = [...next.values()]
  cachedAtMs = Date.now()
}

export function clearMessagingConnectionStatusesCache(): void {
  cachedStatuses = null
  cachedAtMs = null
}
