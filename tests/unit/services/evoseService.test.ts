// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvoseService } from '../../../electron/services/evoseService'
import { EvoseAgentCancelledError } from '../../../src/shared/errors'
import { DEFAULT_EVOSE_SETTINGS } from '../../../src/shared/types'

interface EvoseServiceHarness {
  service: EvoseService
  fetcher: ReturnType<typeof vi.fn>
}

interface HarnessOptions {
  baseUrl?: string
}

function createHarness(options: HarnessOptions = {}): EvoseServiceHarness {
  const fetcher = vi.fn()
  const baseUrl = options.baseUrl ?? 'https://evose.example.test'
  const service = new EvoseService({
    settingsService: {
      getSettings: () => ({
        evose: {
          apiKey: 'evose-api-key',
          baseUrl,
          workspaceIds: ['ws-1'],
          apps: [],
        },
      }),
    } as never,
    getProxyFetch: () => fetcher as unknown as typeof globalThis.fetch,
  })
  return { service, fetcher }
}

describe('EvoseService cancellation semantics', () => {
  let harness: EvoseServiceHarness

  beforeEach(() => {
    harness = createHarness()
  })

  it('runAgent fails fast when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const onEvent = vi.fn()

    await expect(
      harness.service.runAgent({
        appId: 'agent-1',
        input: 'hello',
        signal: controller.signal,
        onEvent,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'cancelled' })
  })

  it('runAgent maps AbortError from fetch to EvoseAgentCancelledError', async () => {
    const controller = new AbortController()
    harness.fetcher.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    const onEvent = vi.fn()

    await expect(
      harness.service.runAgent({
        appId: 'agent-2',
        input: 'hello',
        signal: controller.signal,
        onEvent,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).toHaveBeenCalledTimes(1)
    expect(harness.fetcher.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'cancelled' })
  })

  it('runAgent falls back to default endpoint when baseUrl is blank', async () => {
    harness = createHarness({ baseUrl: '   ' })
    const controller = new AbortController()
    harness.fetcher.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

    await expect(
      harness.service.runAgent({
        appId: 'agent-blank-base-url',
        input: 'hello',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).toHaveBeenCalledTimes(1)
    expect(harness.fetcher.mock.calls[0]?.[0]).toBe(`${DEFAULT_EVOSE_SETTINGS.baseUrl}/open/v1/apps/agent/run`)
  })

  it('runWorkflow fails fast when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      harness.service.runWorkflow({
        appId: 'workflow-1',
        inputs: { city: 'Shanghai' },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).not.toHaveBeenCalled()
  })

  it('runWorkflow maps AbortError from fetch to EvoseAgentCancelledError', async () => {
    const controller = new AbortController()
    harness.fetcher.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

    await expect(
      harness.service.runWorkflow({
        appId: 'workflow-2',
        inputs: { city: 'Shanghai' },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).toHaveBeenCalledTimes(1)
    expect(harness.fetcher.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
    })
  })

  it('runWorkflow falls back to default endpoint when baseUrl is blank', async () => {
    harness = createHarness({ baseUrl: '' })
    const controller = new AbortController()
    harness.fetcher.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

    await expect(
      harness.service.runWorkflow({
        appId: 'workflow-blank-base-url',
        inputs: { city: 'Shanghai' },
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(EvoseAgentCancelledError)

    expect(harness.fetcher).toHaveBeenCalledTimes(1)
    expect(harness.fetcher.mock.calls[0]?.[0]).toBe(`${DEFAULT_EVOSE_SETTINGS.baseUrl}/open/v1/apps/workflow/run`)
  })
})
