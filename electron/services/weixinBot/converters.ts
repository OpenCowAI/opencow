// SPDX-License-Identifier: Apache-2.0

/**
 * Weixin converters — bridge between the unified IMConnection model
 * and WeChat-specific internal types.
 */

import type {
  WeixinConnection,
  IMConnectionStatus,
} from '../../../src/shared/types'
import type { WeixinBotEntry, WeixinBotStatus } from './types'

/** Convert a unified WeixinConnection to the internal WeixinBotEntry format. */
export function toWeixinBotEntry(conn: WeixinConnection): WeixinBotEntry {
  return {
    id: conn.id,
    name: conn.name,
    enabled: conn.enabled,
    botToken: conn.botToken,
    baseUrl: conn.baseUrl,
    allowedUserIds: conn.allowedUserIds,
    defaultWorkspace: conn.defaultWorkspace,
  }
}

/** Convert a WeixinBotStatus to the unified IMConnectionStatus format. */
export function weixinStatusToIMStatus(s: WeixinBotStatus): IMConnectionStatus {
  return {
    connectionId: s.connectionId,
    platform: 'weixin',
    connectionStatus: s.connectionStatus,
    connectedAt: s.connectedAt,
    lastError: s.lastError,
    metadata: {
      messagesReceived: s.messagesReceived,
      messagesSent: s.messagesSent,
    },
  }
}
