// SPDX-License-Identifier: Apache-2.0

/**
 * IM Bridge — internal types for the multi-platform IM abstraction layer.
 *
 * These types are used within the Electron main process only.
 * Cross-process types (IPC, DataBus) live in `src/shared/types.ts`.
 */

import type {
  SessionOrigin,
  IMPlatformType,
  DataBusEvent,
  AppSettings,
} from '../../../src/shared/types'
import { IM_PLATFORM_SOURCES } from '../../../src/shared/types'

// ─── Platform-specific origin type aliases ──────────────────────────────────

export type TelegramOrigin = Extract<SessionOrigin, { source: 'telegram' }>
export type FeishuOrigin   = Extract<SessionOrigin, { source: 'feishu' }>
export type DiscordOrigin  = Extract<SessionOrigin, { source: 'discord' }>
export type WeixinOrigin   = Extract<SessionOrigin, { source: 'weixin' }>

/** Union of all IM-sourced origin variants. */
export type IMOrigin = TelegramOrigin | FeishuOrigin | DiscordOrigin | WeixinOrigin

// ─── Origin helpers ────────────────────────────────────────────────────────

/** Check whether a SessionOrigin comes from an IM platform. */
export function isIMOrigin(origin: SessionOrigin): boolean {
  return IM_PLATFORM_SOURCES.has(origin.source)
}

/**
 * Type-safe extraction of the connection ID (botId / appId) from an IM origin.
 * Uses discriminated union narrowing — zero `as any` casts.
 */
export function getIMConnectionId(origin: SessionOrigin): string | null {
  switch (origin.source) {
    case 'telegram': return origin.botId
    case 'feishu':   return origin.appId
    case 'discord':  return origin.botId
    case 'weixin':   return origin.connectionId
    default:         return null
  }
}

/**
 * Type-safe extraction of the chat/channel identifier from an IM origin.
 * Uses discriminated union narrowing — zero `as any` casts.
 */
export function getIMChatId(origin: SessionOrigin): string | null {
  switch (origin.source) {
    case 'telegram': return origin.chatId
    case 'feishu':   return origin.chatId
    case 'discord':  return origin.channelId
    case 'weixin':   return origin.userId
    default:         return null
  }
}

// ─── Manager deps ──────────────────────────────────────────────────────────

/**
 * Dependencies for IMBridgeManager.
 *
 * Note: platform adapters are registered via `registerAdapter()` after
 * construction, NOT passed as deps. This decouples the manager from
 * specific platform implementations.
 */
export interface IMBridgeManagerDeps {
  dispatch: (event: DataBusEvent) => void
  getSettings: () => AppSettings
}
