// SPDX-License-Identifier: Apache-2.0

import type { WebhookEndpoint } from '../../../src/shared/types'
import type { WebhookProvider, WebhookMessage } from './webhookProvider'
import { WEBHOOK_FETCH_TIMEOUT_MS, buildTestMessage } from './webhookProvider'

export class CustomProvider implements WebhookProvider {
  async send(endpoint: WebhookEndpoint, message: WebhookMessage, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (endpoint.secret) {
      headers['Authorization'] = `Bearer ${endpoint.secret}`
    }

    const payload = {
      event: message.eventKind,
      title: message.title,
      body: message.body,
      sessionId: message.sessionId,
      sessionName: message.sessionName,
      timestamp: message.timestamp,
      metadata: message.metadata ?? {}
    }

    const response = await fetchFn(endpoint.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS)
    })

    return { statusCode: response.status }
  }

  async sendTest(endpoint: WebhookEndpoint, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    return this.send(endpoint, buildTestMessage(), fetchFn)
  }
}
