// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_WINDOW_KEY } from '../../../src/shared/appIdentity'
import type { IMConnectionStatus } from '../../../src/shared/types'

function makeStatus(overrides: Partial<IMConnectionStatus> = {}): IMConnectionStatus {
  return {
    connectionId: 'conn-1',
    platform: 'telegram',
    connectionStatus: 'connected',
    connectedAt: 1,
    lastError: null,
    ...overrides,
  }
}

describe('messagingStatusQueryService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useRealTimers()
    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {}
  })

  it('de-duplicates concurrent status queries and reuses cache', async () => {
    const firstSnapshot = [makeStatus({ connectionId: 'conn-a' })]
    let resolveRequest: ((value: IMConnectionStatus[]) => void) | null = null
    const listStatuses = vi.fn(() => new Promise<IMConnectionStatus[]>((resolve) => {
      resolveRequest = resolve
    }))

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'messaging:get-all-statuses': listStatuses,
    }

    const service = await import('../../../src/renderer/lib/query/messagingStatusQueryService')

    const queryA = service.queryMessagingConnectionStatuses()
    const queryB = service.queryMessagingConnectionStatuses()

    expect(listStatuses).toHaveBeenCalledTimes(1)
    resolveRequest?.(firstSnapshot)

    await expect(queryA).resolves.toEqual(firstSnapshot)
    await expect(queryB).resolves.toEqual(firstSnapshot)

    const cached = await service.queryMessagingConnectionStatuses()
    expect(cached).toEqual(firstSnapshot)
    expect(listStatuses).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache when force is enabled', async () => {
    const firstSnapshot = [makeStatus({ connectionId: 'conn-a' })]
    const secondSnapshot = [makeStatus({ connectionId: 'conn-b' })]

    const listStatuses = vi
      .fn<() => Promise<IMConnectionStatus[]>>()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(secondSnapshot)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'messaging:get-all-statuses': listStatuses,
    }

    const service = await import('../../../src/renderer/lib/query/messagingStatusQueryService')

    await service.queryMessagingConnectionStatuses()
    const refreshed = await service.queryMessagingConnectionStatuses({ force: true })

    expect(refreshed).toEqual(secondSnapshot)
    expect(listStatuses).toHaveBeenCalledTimes(2)
  })

  it('refreshes cache after ttl expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const firstSnapshot = [makeStatus({ connectionId: 'conn-a' })]
    const secondSnapshot = [makeStatus({ connectionId: 'conn-b' })]
    const listStatuses = vi
      .fn<() => Promise<IMConnectionStatus[]>>()
      .mockResolvedValueOnce(firstSnapshot)
      .mockResolvedValueOnce(secondSnapshot)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'messaging:get-all-statuses': listStatuses,
    }

    const service = await import('../../../src/renderer/lib/query/messagingStatusQueryService')

    await service.queryMessagingConnectionStatuses({ maxAgeMs: 100 })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.050Z'))
    await service.queryMessagingConnectionStatuses({ maxAgeMs: 100 })
    expect(listStatuses).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:00.101Z'))
    const refreshed = await service.queryMessagingConnectionStatuses({ maxAgeMs: 100 })
    expect(refreshed).toEqual(secondSnapshot)
    expect(listStatuses).toHaveBeenCalledTimes(2)
  })
})
