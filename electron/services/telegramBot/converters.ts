// SPDX-License-Identifier: Apache-2.0

/**
 * Telegram converters — bridge between the unified IMConnection model
 * and Telegram-specific internal types.
 *
 * These functions live in the Electron main process only.
 * They are intentionally NOT in `src/shared/types.ts` because the renderer
 * process never needs to perform these conversions.
 */

import type {
  TelegramConnection,
  TelegramBotEntry,
  TelegramBotStatus,
  IMConnectionStatus,
} from '../../../src/shared/types'

/** Convert a unified TelegramConnection to the internal TelegramBotEntry format. */
export function toTelegramBotEntry(conn: TelegramConnection): TelegramBotEntry {
  return {
    id: conn.id,
    name: conn.name,
    enabled: conn.enabled,
    botToken: conn.botToken,
    allowedUserIds: conn.allowedUserIds.map(Number).filter((n) => !isNaN(n)),
    defaultWorkspace: conn.defaultWorkspace,
  }
}

/** Convert a TelegramBotStatus to the unified IMConnectionStatus format. */
export function telegramStatusToIMStatus(s: TelegramBotStatus): IMConnectionStatus {
  return {
    connectionId: s.botId,
    platform: 'telegram',
    connectionStatus: s.connectionStatus,
    connectedAt: s.connectedAt,
    lastError: s.lastError,
    metadata: {
      botUsername: s.botUsername ?? undefined,
      messagesReceived: s.messagesReceived,
      messagesSent: s.messagesSent,
    },
  }
}
