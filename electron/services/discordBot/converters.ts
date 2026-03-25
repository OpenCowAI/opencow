// SPDX-License-Identifier: Apache-2.0

/**
 * Discord converters — bridge between unified IMConnection and internal types.
 */

import type { DiscordConnection, IMConnectionStatus } from '../../../src/shared/types'
import type { DiscordBotEntry, DiscordBotStatus } from './types'

export function toDiscordBotEntry(conn: DiscordConnection): DiscordBotEntry {
  return {
    id: conn.id,
    name: conn.name,
    enabled: conn.enabled,
    botToken: conn.botToken,
    guildId: conn.guildId,
    allowedUserIds: conn.allowedUserIds,
    defaultWorkspacePath: conn.defaultWorkspacePath,
    defaultProjectId: conn.defaultProjectId,
  }
}

export function discordStatusToIMStatus(s: DiscordBotStatus): IMConnectionStatus {
  return {
    connectionId: s.botId,
    platform: 'discord',
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
