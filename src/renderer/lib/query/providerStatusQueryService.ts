// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind, ProviderStatus } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

export interface QueryProviderStatusInput {
  engineKind: AIEngineKind
  force?: boolean
  maxAgeMs?: number
}

export interface PrimeProviderStatusCacheInput {
  engineKind: AIEngineKind
  status: ProviderStatus | null
}

const inFlightQueries = new Map<AIEngineKind, Promise<ProviderStatus>>()
const cachedStatuses = new Map<AIEngineKind, ProviderStatus>()
const cachedAtByEngine = new Map<AIEngineKind, number>()

const DEFAULT_CACHE_MAX_AGE_MS = 15_000

function hasFreshCache(engineKind: AIEngineKind, maxAgeMs: number): boolean {
  const cachedAt = cachedAtByEngine.get(engineKind)
  if (!cachedStatuses.has(engineKind) || typeof cachedAt !== 'number') return false
  return Date.now() - cachedAt <= maxAgeMs
}

/**
 * Query provider status for a specific engine with single-flight de-duplication.
 *
 * - Concurrent callers for the same engine share one IPC request.
 * - Cached result is returned unless `force` is set.
 */
export function queryProviderStatus(
  { engineKind, force = false, maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS }: QueryProviderStatusInput,
): Promise<ProviderStatus> {
  if (!force && hasFreshCache(engineKind, maxAgeMs)) return Promise.resolve(cachedStatuses.get(engineKind)!)

  const existing = inFlightQueries.get(engineKind)
  if (existing) return existing

  const request = getAppAPI()['provider:get-status'](engineKind)
    .then((status) => {
      cachedStatuses.set(engineKind, status)
      cachedAtByEngine.set(engineKind, Date.now())
      return status
    })
    .finally(() => {
      inFlightQueries.delete(engineKind)
    })

  inFlightQueries.set(engineKind, request)
  return request
}

/**
 * Prime or clear cache entry based on the latest known status.
 */
export function primeProviderStatusCache({ engineKind, status }: PrimeProviderStatusCacheInput): void {
  if (!status) {
    cachedStatuses.delete(engineKind)
    cachedAtByEngine.delete(engineKind)
    return
  }
  cachedStatuses.set(engineKind, status)
  cachedAtByEngine.set(engineKind, Date.now())
}

export function clearProviderStatusCache(engineKind?: AIEngineKind): void {
  if (engineKind) {
    cachedStatuses.delete(engineKind)
    cachedAtByEngine.delete(engineKind)
    return
  }
  cachedStatuses.clear()
  cachedAtByEngine.clear()
}
