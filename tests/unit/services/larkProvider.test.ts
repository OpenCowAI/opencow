// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LarkProvider, computeLarkSign } from '../../../electron/services/webhooks/larkProvider'
import type { WebhookEndpoint } from '../../../src/shared/types'
import type { WebhookMessage } from '../../../electron/services/webhooks/webhookProvider'

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'ep-lark',
    name: 'Lark Bot',
    provider: 'lark',
    url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-hook-id',
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

describe('LarkProvider', () => {
  const provider = new LarkProvider()

  it('sends POST to endpoint URL with correct Content-Type', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('https://open.feishu.cn/open-apis/bot/v2/hook/test-hook-id')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('formats interactive card JSON correctly', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.msg_type).toBe('interactive')
    expect(body.card.header.title.content).toBe('OpenCow \u2014 Session Completed')
    expect(body.card.header.template).toBe('green') // session_complete → green
    expect(body.card.elements).toHaveLength(2)
    expect(body.card.elements[0].text.content).toContain('has finished')
  })

  it('uses correct color for error events', async () => {
    await provider.send(makeEndpoint(), makeMessage({ eventKind: 'session_error' }), mockFetch)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.card.header.template).toBe('red')
  })

  it('uses correct color for waiting events', async () => {
    await provider.send(makeEndpoint(), makeMessage({ eventKind: 'session_waiting' }), mockFetch)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.card.header.template).toBe('orange')
  })

  it('does NOT include signature fields when secret is empty', async () => {
    await provider.send(makeEndpoint({ secret: '' }), makeMessage(), mockFetch)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.timestamp).toBeUndefined()
    expect(body.sign).toBeUndefined()
  })

  it('includes timestamp and sign when secret is set', async () => {
    await provider.send(makeEndpoint({ secret: 'my-secret' }), makeMessage(), mockFetch)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.timestamp).toBeDefined()
    expect(body.sign).toBeDefined()
    expect(typeof body.sign).toBe('string')
  })

  it('includes AbortSignal timeout', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)
    const options = mockFetch.mock.calls[0][1]
    expect(options.signal).toBeDefined()
  })

  it('returns status code from response', async () => {
    mockFetch.mockResolvedValue({ status: 200 })
    const result = await provider.send(makeEndpoint(), makeMessage(), mockFetch)
    expect(result.statusCode).toBe(200)
  })
})

describe('computeLarkSign', () => {
  it('computes HMAC-SHA256 signature correctly', () => {
    // The Lark signing uses (timestamp + "\n" + secret) as the HMAC key
    // and signs an empty string
    const sign = computeLarkSign('1708300000', 'test-secret')
    expect(typeof sign).toBe('string')
    expect(sign.length).toBeGreaterThan(0)
    // Base64 encoded
    expect(sign).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('produces different signatures for different timestamps', () => {
    const sign1 = computeLarkSign('1708300000', 'secret')
    const sign2 = computeLarkSign('1708300001', 'secret')
    expect(sign1).not.toBe(sign2)
  })

  it('produces different signatures for different secrets', () => {
    const sign1 = computeLarkSign('1708300000', 'secret-a')
    const sign2 = computeLarkSign('1708300000', 'secret-b')
    expect(sign1).not.toBe(sign2)
  })
})
