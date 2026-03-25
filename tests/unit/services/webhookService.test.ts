// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebhookService } from '../../../electron/services/webhooks/webhookService'
import type {
  StatusTransition,
  SessionStatus,
  EngineEventEnvelope,
  WebhookEndpoint,
  WebhookEventKind
} from '../../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'ep-1',
    name: 'Test Hook',
    provider: 'custom',
    url: 'https://example.com/hook',
    secret: '',
    enabled: true,
    subscribedEvents: ['session_complete', 'session_error'],
    createdAt: Date.now(),
    lastTriggeredAt: null,
    lastError: null,
    ...overrides
  }
}

function makeTransition(
  newStatus: SessionStatus,
  previousStatus: SessionStatus = 'active',
  name = 'Test session'
): StatusTransition {
  return {
    sessionId: 'sess-1',
    sessionName: name,
    previousStatus,
    newStatus,
    timestamp: Date.now()
  }
}

function makeEngineEvent(
  eventType: string,
  payload: Record<string, unknown> = {}
): EngineEventEnvelope {
  return {
    eventId: `evt-${eventType}`,
    sourceEventId: null,
    occurredAtMs: Date.now(),
    source: 'hook',
    timestamp: new Date().toISOString(),
    rawEventName: eventType,
    eventType: eventType as EngineEventEnvelope['eventType'],
    sessionRef: 'sess-1',
    payload
  }
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockResolvedValue({ status: 200 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookService', () => {
  let service: WebhookService
  let endpoints: WebhookEndpoint[]

  beforeEach(() => {
    endpoints = [makeEndpoint()]
    service = new WebhookService({
      getEndpoints: () => endpoints,
      getProxyFetch: () => globalThis.fetch
    })
  })

  afterEach(() => {
    service.stop()
  })

  // --- Event filtering ---

  it('sends webhook on session_complete transition', async () => {
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends webhook on session_error transition', async () => {
    await service.onTransition(makeTransition('error'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends webhook on session_waiting transition', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_waiting'] })]
    await service.onTransition(makeTransition('waiting'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT map active transition (session_start comes from EngineEvent only)', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_start'] })]
    await service.onTransition(makeTransition('active', 'waiting'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends webhook on session_start engine event', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_start'] })]
    await service.onEngineEvent(makeEngineEvent('session_start'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends webhook on task_completed engine event', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['task_completed'] })]
    await service.onEngineEvent(makeEngineEvent('task_completed', { task_subject: 'Fix bug' }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('sends webhook on notification engine event', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['notification'] })]
    await service.onEngineEvent(makeEngineEvent('notification', { title: 'Hello' }))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT send for engine event types mapped to StatusTransition (session_stop, session_error)', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_complete', 'session_error'] })]
    await service.onEngineEvent(makeEngineEvent('session_stop'))
    await service.onEngineEvent(makeEngineEvent('session_error'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('ignores unmapped engine event kinds', async () => {
    await service.onEngineEvent(makeEngineEvent('subagent_start'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  // --- Endpoint filtering ---

  it('does not send when no endpoints are enabled', async () => {
    endpoints = [makeEndpoint({ enabled: false })]
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not send when endpoint does not subscribe to the event', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_error'] })]
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not crash with empty endpoints list', async () => {
    endpoints = []
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends to multiple matching endpoints in parallel', async () => {
    endpoints = [
      makeEndpoint({ id: 'ep-1' }),
      makeEndpoint({ id: 'ep-2', name: 'Hook 2', url: 'https://example.com/hook2' })
    ]
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // --- Dedup ---

  it('deduplicates same event within 10s window', async () => {
    const transition = makeTransition('completed')
    await service.onTransition(transition)
    await service.onTransition(transition)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does NOT deduplicate same session+kind when engine event ids are different', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['task_completed'] })]
    await service.onEngineEvent(makeEngineEvent('task_completed', { task_subject: 'A' }))
    await service.onEngineEvent({
      ...makeEngineEvent('task_completed', { task_subject: 'B' }),
      eventId: 'evt-task-completed-2',
    })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does NOT deduplicate different event kinds', async () => {
    endpoints = [makeEndpoint({ subscribedEvents: ['session_complete', 'session_error'] })]
    await service.onTransition(makeTransition('completed'))
    await service.onTransition(makeTransition('error'))
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does NOT deduplicate different sessions', async () => {
    const t1 = makeTransition('completed')
    const t2 = makeTransition('completed')
    t2.sessionId = 'sess-2'
    t2.sessionName = 'Another session'
    await service.onTransition(t1)
    await service.onTransition(t2)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  // --- Retry ---

  it('retries on 5xx error (up to 2 retries)', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 })

    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry on 4xx error', async () => {
    mockFetch.mockResolvedValue({ status: 400 })
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retries on network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ status: 200 })

    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('does not crash when all retries exhausted', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    // Should not throw
    await service.onTransition(makeTransition('completed'))
    expect(mockFetch).toHaveBeenCalledTimes(3) // 1 + 2 retries
  })

  // --- testEndpoint ---

  it('testEndpoint returns success for 200 status', async () => {
    mockFetch.mockResolvedValue({ status: 200 })
    const result = await service.testEndpoint(makeEndpoint())
    expect(result.success).toBe(true)
    expect(result.statusCode).toBe(200)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('testEndpoint returns failure for 500 status', async () => {
    mockFetch.mockResolvedValue({ status: 500 })
    const result = await service.testEndpoint(makeEndpoint())
    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(500)
  })

  it('testEndpoint returns failure for network error', async () => {
    mockFetch.mockRejectedValue(new Error('timeout'))
    const result = await service.testEndpoint(makeEndpoint())
    expect(result.success).toBe(false)
    expect(result.error).toBe('timeout')
  })

  it('testEndpoint returns failure for unknown provider', async () => {
    const ep = makeEndpoint({ provider: 'unknown' as WebhookEndpoint['provider'] })
    const result = await service.testEndpoint(ep)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown provider')
  })
})
