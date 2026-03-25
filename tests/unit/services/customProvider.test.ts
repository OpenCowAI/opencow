// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CustomProvider } from '../../../electron/services/webhooks/customProvider'
import type { WebhookEndpoint } from '../../../src/shared/types'
import type { WebhookMessage } from '../../../electron/services/webhooks/webhookProvider'

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'ep-custom',
    name: 'Custom Hook',
    provider: 'custom',
    url: 'https://example.com/webhook',
    secret: '',
    enabled: true,
    subscribedEvents: ['session_complete'],
    createdAt: Date.now(),
    lastTriggeredAt: null,
    lastError: null,
    ...overrides
  }
}

function makeMessage(overrides: Partial<WebhookMessage> = {}): WebhookMessage {
  return {
    title: 'OpenCow \u2014 Session Completed',
    body: '\u201cMy Session\u201d has finished',
    sessionId: 'sess-1',
    sessionName: 'My Session',
    eventKind: 'session_complete',
    timestamp: 1708300000000,
    ...overrides
  }
}

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockResolvedValue({ status: 200 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CustomProvider', () => {
  const provider = new CustomProvider()

  it('sends POST to endpoint URL', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://example.com/webhook')
    expect(options.method).toBe('POST')
  })

  it('sends correct JSON payload structure', async () => {
    const msg = makeMessage({ metadata: { extra: 'data' } })
    await provider.send(makeEndpoint(), msg, mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({
      event: 'session_complete',
      title: 'OpenCow \u2014 Session Completed',
      body: '\u201cMy Session\u201d has finished',
      sessionId: 'sess-1',
      sessionName: 'My Session',
      timestamp: 1708300000000,
      metadata: { extra: 'data' }
    })
  })

  it('sends empty metadata when not provided', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.metadata).toEqual({})
  })

  it('sets Content-Type header', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes Authorization header when secret is set', async () => {
    await provider.send(makeEndpoint({ secret: 'my-token-123' }), makeMessage(), mockFetch)

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Authorization']).toBe('Bearer my-token-123')
  })

  it('omits Authorization header when no secret', async () => {
    await provider.send(makeEndpoint({ secret: '' }), makeMessage(), mockFetch)

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Authorization']).toBeUndefined()
  })

  it('includes AbortSignal timeout', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)
    const options = mockFetch.mock.calls[0][1]
    expect(options.signal).toBeDefined()
  })

  it('returns status code from response', async () => {
    mockFetch.mockResolvedValue({ status: 201 })
    const result = await provider.send(makeEndpoint(), makeMessage(), mockFetch)
    expect(result.statusCode).toBe(201)
  })

  it('sendTest sends a test message', async () => {
    const result = await provider.sendTest(makeEndpoint(), mockFetch)
    expect(result.statusCode).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.event).toBe('notification')
    expect(body.title).toContain('Webhook Test')
  })
})
