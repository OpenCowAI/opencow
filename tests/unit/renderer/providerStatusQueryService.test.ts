// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_WINDOW_KEY } from '../../../src/shared/appIdentity'
import type { ProviderStatus } from '../../../src/shared/types'

function makeStatus(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    state: 'authenticated',
    mode: 'subscription',
    ...overrides,
  }
}

describe('providerStatusQueryService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useRealTimers()
    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {}
  })

  it('de-duplicates concurrent queries and reuses cache', async () => {
    const firstStatus = makeStatus()
    let resolveRequest: ((value: ProviderStatus) => void) | null = null
    const getStatus = vi.fn(() => new Promise<ProviderStatus>((resolve) => {
      resolveRequest = resolve
    }))

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    const requestA = service.queryProviderStatus()
    const requestB = service.queryProviderStatus()

    expect(getStatus).toHaveBeenCalledTimes(1)
    resolveRequest?.(firstStatus)

    await expect(requestA).resolves.toEqual(firstStatus)
    await expect(requestB).resolves.toEqual(firstStatus)

    const cached = await service.queryProviderStatus()
    expect(cached).toEqual(firstStatus)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache when force is enabled', async () => {
    const initial = makeStatus({ mode: 'subscription' })
    const refreshed = makeStatus({ mode: 'api_key' })
    const getStatus = vi
      .fn<() => Promise<ProviderStatus>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    await service.queryProviderStatus()
    const next = await service.queryProviderStatus({ force: true })

    expect(next).toEqual(refreshed)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('refreshes cache after ttl expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const initial = makeStatus({ mode: 'subscription' })
    const refreshed = makeStatus({ mode: 'api_key' })
    const getStatus = vi
      .fn<() => Promise<ProviderStatus>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    await service.queryProviderStatus({ maxAgeMs: 100 })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.050Z'))
    await service.queryProviderStatus({ maxAgeMs: 100 })
    expect(getStatus).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:00.101Z'))
    const next = await service.queryProviderStatus({ maxAgeMs: 100 })
    expect(next).toEqual(refreshed)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
