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

  it('de-duplicates concurrent queries per engine and reuses cache', async () => {
    const firstClaudeStatus = makeStatus()
    let resolveRequest: ((value: ProviderStatus) => void) | null = null
    const getStatus = vi.fn(() => new Promise<ProviderStatus>((resolve) => {
      resolveRequest = resolve
    }))

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    const requestA = service.queryProviderStatus({ engineKind: 'claude' })
    const requestB = service.queryProviderStatus({ engineKind: 'claude' })

    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(getStatus).toHaveBeenCalledWith('claude')
    resolveRequest?.(firstClaudeStatus)

    await expect(requestA).resolves.toEqual(firstClaudeStatus)
    await expect(requestB).resolves.toEqual(firstClaudeStatus)

    const cached = await service.queryProviderStatus({ engineKind: 'claude' })
    expect(cached).toEqual(firstClaudeStatus)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps cache and in-flight isolation per engine', async () => {
    const claudeStatus = makeStatus({ mode: 'subscription' })
    const codexStatus = makeStatus({ mode: 'api_key' })
    const getStatus = vi
      .fn<(engineKind: 'claude' | 'codex') => Promise<ProviderStatus>>()
      .mockImplementation(async (engineKind) => (engineKind === 'claude' ? claudeStatus : codexStatus))

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    const [claude, codex] = await Promise.all([
      service.queryProviderStatus({ engineKind: 'claude' }),
      service.queryProviderStatus({ engineKind: 'codex' }),
    ])

    expect(claude).toEqual(claudeStatus)
    expect(codex).toEqual(codexStatus)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('bypasses cache when force is enabled', async () => {
    const initial = makeStatus({ mode: 'subscription' })
    const refreshed = makeStatus({ mode: 'api_key' })
    const getStatus = vi
      .fn<(engineKind: 'claude' | 'codex') => Promise<ProviderStatus>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    await service.queryProviderStatus({ engineKind: 'claude' })
    const next = await service.queryProviderStatus({ engineKind: 'claude', force: true })

    expect(next).toEqual(refreshed)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('refreshes per-engine cache after ttl expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const initial = makeStatus({ mode: 'subscription' })
    const refreshed = makeStatus({ mode: 'api_key' })
    const getStatus = vi
      .fn<(engineKind: 'claude' | 'codex') => Promise<ProviderStatus>>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(refreshed)

    ;(window as unknown as Record<string, unknown>)[APP_WINDOW_KEY] = {
      'provider:get-status': getStatus,
    }

    const service = await import('../../../src/renderer/lib/query/providerStatusQueryService')

    await service.queryProviderStatus({ engineKind: 'claude', maxAgeMs: 100 })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.050Z'))
    await service.queryProviderStatus({ engineKind: 'claude', maxAgeMs: 100 })
    expect(getStatus).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-01-01T00:00:00.101Z'))
    const next = await service.queryProviderStatus({ engineKind: 'claude', maxAgeMs: 100 })
    expect(next).toEqual(refreshed)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })
})
