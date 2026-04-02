// SPDX-License-Identifier: Apache-2.0

/**
 * Feishu converters — bridge between unified IMConnection and internal types.
 */

import type { FeishuConnection, IMConnectionStatus } from '../../../src/shared/types'
import type { FeishuBotEntry, FeishuBotStatus } from './types'

export function toFeishuBotEntry(conn: FeishuConnection): FeishuBotEntry {
  return {
    id: conn.id,
    name: conn.name,
    enabled: conn.enabled,
    domain: conn.domain ?? 'feishu',
    appId: conn.appId,
    appSecret: conn.appSecret,
    allowedUserIds: conn.allowedUserIds,
    defaultWorkspace: conn.defaultWorkspace,
  }
}

export function feishuStatusToIMStatus(s: FeishuBotStatus): IMConnectionStatus {
  return {
    connectionId: s.botId,
    platform: 'feishu',
    connectionStatus: s.connectionStatus,
    connectedAt: s.connectedAt,
    lastError: s.lastError,
    metadata: {
      botUsername: s.botName ?? undefined,
      messagesReceived: s.messagesReceived,
      messagesSent: s.messagesSent,
    },
  }
}
