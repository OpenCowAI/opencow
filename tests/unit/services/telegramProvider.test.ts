// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelegramProvider, escapeTelegramMd } from '../../../electron/services/webhooks/telegramProvider'
import type { WebhookEndpoint } from '../../../src/shared/types'
import type { WebhookMessage } from '../../../electron/services/webhooks/webhookProvider'

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'ep-tg',
    name: 'Telegram Bot',
    provider: 'telegram',
    url: '-1001234567890', // chat_id
    secret: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', // bot token
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

describe('TelegramProvider', () => {
  const provider = new TelegramProvider()

  it('constructs correct Bot API URL from token', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe(
      'https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage'
    )
  })

  it('sends chat_id from endpoint.url field', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.chat_id).toBe('-1001234567890')
  })

  it('sets parse_mode to MarkdownV2', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.parse_mode).toBe('MarkdownV2')
  })

  it('formats message with title and body', async () => {
    await provider.send(makeEndpoint(), makeMessage(), mockFetch)

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.text).toContain('Session Completed')
    expect(body.text).toContain('has finished')
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

describe('escapeTelegramMd', () => {
  it('escapes underscores', () => {
    expect(escapeTelegramMd('hello_world')).toBe('hello\\_world')
  })

  it('escapes asterisks', () => {
    expect(escapeTelegramMd('*bold*')).toBe('\\*bold\\*')
  })

  it('escapes brackets', () => {
    expect(escapeTelegramMd('[link](url)')).toBe('\\[link\\]\\(url\\)')
  })

  it('escapes dots', () => {
    expect(escapeTelegramMd('v1.2.3')).toBe('v1\\.2\\.3')
  })

  it('escapes hyphens', () => {
    expect(escapeTelegramMd('a-b-c')).toBe('a\\-b\\-c')
  })

  it('escapes tilde and backtick', () => {
    expect(escapeTelegramMd('~strikethrough~ and `code`')).toBe(
      '\\~strikethrough\\~ and \\`code\\`'
    )
  })

  it('escapes exclamation mark', () => {
    expect(escapeTelegramMd('Hello!')).toBe('Hello\\!')
  })

  it('handles empty string', () => {
    expect(escapeTelegramMd('')).toBe('')
  })

  it('handles string with no special characters', () => {
    expect(escapeTelegramMd('hello world 123')).toBe('hello world 123')
  })

  it('escapes multiple special characters in sequence', () => {
    expect(escapeTelegramMd('**bold** and __italic__')).toBe(
      '\\*\\*bold\\*\\* and \\_\\_italic\\_\\_'
    )
  })
})
