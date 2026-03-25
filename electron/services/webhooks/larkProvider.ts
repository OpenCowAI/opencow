// SPDX-License-Identifier: Apache-2.0

import { createHmac } from 'crypto'
import type { WebhookEndpoint, WebhookEventKind } from '../../../src/shared/types'
import type { WebhookProvider, WebhookMessage } from './webhookProvider'
import { WEBHOOK_FETCH_TIMEOUT_MS, buildTestMessage } from './webhookProvider'

/** Map event kind to Lark card header template color. */
const EVENT_COLOR: Record<WebhookEventKind, string> = {
  session_complete: 'green',
  session_error: 'red',
  session_waiting: 'orange',
  session_start: 'blue',
  task_completed: 'turquoise',
  notification: 'indigo'
}

/**
 * Compute Lark webhook signing signature.
 *
 * Per Lark docs the HMAC key is `timestamp + "\n" + secret` and the
 * message to sign is an empty string.
 */
export function computeLarkSign(timestamp: string, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`
  return createHmac('sha256', stringToSign).update('').digest('base64')
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

export class LarkProvider implements WebhookProvider {
  async send(endpoint: WebhookEndpoint, message: WebhookMessage, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    const color = EVENT_COLOR[message.eventKind] ?? 'blue'

    const card = {
      header: {
        title: { content: message.title, tag: 'plain_text' as const },
        template: color
      },
      elements: [
        {
          tag: 'div' as const,
          text: { content: message.body, tag: 'lark_md' as const }
        },
        {
          tag: 'div' as const,
          text: {
            content: `**Session:** ${message.sessionName}\n**Time:** ${formatTimestamp(message.timestamp)}`,
            tag: 'lark_md' as const
          }
        }
      ]
    }

    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      card
    }

    // Add signature if secret is configured
    if (endpoint.secret) {
      const timestamp = Math.floor(Date.now() / 1000).toString()
      body.timestamp = timestamp
      body.sign = computeLarkSign(timestamp, endpoint.secret)
    }

    const response = await fetchFn(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS)
    })

    return { statusCode: response.status }
  }

  async sendTest(endpoint: WebhookEndpoint, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    return this.send(endpoint, buildTestMessage(), fetchFn)
  }
}
