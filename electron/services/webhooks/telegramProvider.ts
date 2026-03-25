// SPDX-License-Identifier: Apache-2.0

import type { WebhookEndpoint, WebhookEventKind } from '../../../src/shared/types'
import type { WebhookProvider, WebhookMessage } from './webhookProvider'
import { WEBHOOK_FETCH_TIMEOUT_MS, buildTestMessage } from './webhookProvider'

/** Escape special characters for Telegram MarkdownV2 format. */
export function escapeTelegramMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

/** Emoji prefix for each event kind. */
const EVENT_EMOJI: Record<WebhookEventKind, string> = {
  session_complete: '\u2705',
  session_error: '\u274c',
  session_waiting: '\u23f3',
  session_start: '\ud83d\ude80',
  task_completed: '\u2611\ufe0f',
  notification: '\ud83d\udd14'
}

export class TelegramProvider implements WebhookProvider {
  async send(endpoint: WebhookEndpoint, message: WebhookMessage, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    const emoji = EVENT_EMOJI[message.eventKind] ?? '\ud83d\udd14'
    const time = new Date(message.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })

    const text = [
      `${emoji} *${escapeTelegramMd(message.title)}*`,
      '',
      escapeTelegramMd(message.body),
      '',
      `\ud83d\udccc *Session:* \`${escapeTelegramMd(message.sessionName)}\``,
      `\ud83d\udd52 *Time:* ${escapeTelegramMd(time)}`
    ].join('\n')

    // endpoint.secret = bot token, endpoint.url = chat_id
    const apiUrl = `https://api.telegram.org/bot${endpoint.secret}/sendMessage`

    const response = await fetchFn(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: endpoint.url,
        text,
        parse_mode: 'MarkdownV2'
      }),
      signal: AbortSignal.timeout(WEBHOOK_FETCH_TIMEOUT_MS)
    })

    return { statusCode: response.status }
  }

  async sendTest(endpoint: WebhookEndpoint, fetchFn: typeof globalThis.fetch): Promise<{ statusCode: number }> {
    return this.send(endpoint, buildTestMessage(), fetchFn)
  }
}
