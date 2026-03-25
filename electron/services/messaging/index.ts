// SPDX-License-Identifier: Apache-2.0

export { IMBridgeManager } from './imBridgeManager'
export { isIMOrigin, getIMConnectionId, getIMChatId } from './types'
export { findActiveIMSession, routeIMMessage } from './sessionRouter'
export { executeCommand, resolveSessionId, listSessionsForContext } from './commandHandler'
export type { IMAdapter } from './adapter'
export type { IMBridgeManagerDeps, TelegramOrigin, FeishuOrigin, DiscordOrigin, IMOrigin } from './types'
export type { RouteMessageResult } from './sessionRouter'
export type { CommandResult, CommandContext, SessionSummary } from './commandHandler'
