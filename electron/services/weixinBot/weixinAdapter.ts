// SPDX-License-Identifier: Apache-2.0

/**
 * WeixinAdapter — wraps WeixinBotManager to conform to the unified IMAdapter interface.
 *
 * Thin delegation layer following the same pattern as TelegramAdapter / FeishuAdapter / DiscordAdapter.
 * Handles:
 *   1. Platform filtering: syncWithSettings filters for WeixinConnection, converts via converters.
 *   2. Status mapping: converts WeixinBotStatus → IMConnectionStatus.
 *   3. Origin narrowing: casts SessionOrigin to the weixin variant.
 */

import type { IMAdapter } from '../messaging/adapter'
import type { WeixinBotManager } from './weixinBotManager'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  WeixinConnection,
} from '../../../src/shared/types'
import type { WeixinOrigin } from '../messaging/types'
import { toWeixinBotEntry, weixinStatusToIMStatus } from './converters'

export class WeixinAdapter implements IMAdapter {
  readonly platform = 'weixin' as const

  constructor(private readonly manager: WeixinBotManager) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async startAll(): Promise<void> {
    await this.manager.startAll()
  }

  stopAll(): void {
    this.manager.stopAll()
  }

  // ── Connection management ─────────────────────────────────────────────────

  hasConnection(connectionId: string): boolean {
    return this.manager.hasConnection(connectionId)
  }

  async startConnection(connectionId: string): Promise<void> {
    await this.manager.startBot(connectionId)
  }

  stopConnection(connectionId: string): void {
    this.manager.stopBot(connectionId)
  }

  async testConnection(connectionId: string): Promise<{ success: boolean; error?: string }> {
    return this.manager.testBot(connectionId)
  }

  // ── Settings sync ─────────────────────────────────────────────────────────

  async syncWithSettings(connections: IMConnection[]): Promise<void> {
    const weixinConns = connections.filter(
      (c): c is WeixinConnection => c.platform === 'weixin',
    )
    await this.manager.syncWithSettings({
      bots: weixinConns.map(toWeixinBotEntry),
    })
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getAllStatuses(): IMConnectionStatus[] {
    return this.manager.getAllStatuses().map(weixinStatusToIMStatus)
  }

  // ── Message routing ───────────────────────────────────────────────────────

  async handleAssistantMessage(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    await this.manager.handleAssistantMessage(this.narrowOrigin(origin), message, sessionId)
  }

  async handleEvoseProgress(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    await this.manager.handleEvoseProgress(this.narrowOrigin(origin), message, sessionId)
  }

  releaseActivePlaceholder(origin: SessionOrigin): void {
    this.manager.releaseActivePlaceholder(this.narrowOrigin(origin))
  }

  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    await this.manager.notifySessionDone(this.narrowOrigin(origin), stopReason)
  }

  // ── Origin narrowing ──────────────────────────────────────────────────────

  private narrowOrigin(origin: SessionOrigin): WeixinOrigin {
    if (origin.source !== 'weixin') {
      throw new Error(`WeixinAdapter received non-weixin origin: ${origin.source}`)
    }
    return origin
  }
}
