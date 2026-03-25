// SPDX-License-Identifier: Apache-2.0

import type { WebhookEndpoint, WebhookEventKind } from '../../../src/shared/types'

export interface WebhookMessage {
  eventId?: string
  title: string
  body: string
  sessionId: string
  sessionName: string
  eventKind: WebhookEventKind
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface WebhookProvider {
  /** Format and send message to endpoint. Returns HTTP status code. */
  send(endpoint: WebhookEndpoint, message: WebhookMessage, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }>
  /** Send a test/ping message to validate endpoint configuration. */
  sendTest(endpoint: WebhookEndpoint, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }>
}

/** Default timeout for all webhook HTTP requests (10 seconds). */
export const WEBHOOK_FETCH_TIMEOUT_MS = 10_000

/** Build a test message for sendTest implementations. */
export function buildTestMessage(): WebhookMessage {
  return {
    title: 'OpenCow — Webhook Test',
    body: 'This is a test message from OpenCow. Your webhook is configured correctly!',
    sessionId: 'test',
    sessionName: 'Test Session',
    eventKind: 'notification',
    timestamp: Date.now()
  }
}
