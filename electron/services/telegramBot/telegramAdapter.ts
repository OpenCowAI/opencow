// SPDX-License-Identifier: Apache-2.0

/**
 * TelegramAdapter — wraps the existing TelegramBotManager to conform to the
 * unified IMAdapter interface.
 *
 * This is a thin delegation layer.  Zero changes to TelegramBotManager internals.
 * The adapter handles:
 *   1. Platform filtering: syncWithSettings receives all connections,
 *      filters for Telegram, converts to TelegramBotEntry via converters.
 *   2. Status mapping: converts TelegramBotStatus → IMConnectionStatus.
 *   3. Origin narrowing: casts SessionOrigin to the telegram variant.
 */

import type { IMAdapter } from '../messaging/adapter'
import type { TelegramBotManager } from './telegramBotManager'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  TelegramConnection,
} from '../../../src/shared/types'
import type { TelegramOrigin } from '../messaging/types'
import { toTelegramBotEntry, telegramStatusToIMStatus } from './converters'

export class TelegramAdapter implements IMAdapter {
  readonly platform = 'telegram' as const

  constructor(private readonly manager: TelegramBotManager) {}

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
    const telegramConns = connections.filter(
      (c): c is TelegramConnection => c.platform === 'telegram',
    )
    await this.manager.syncWithSettings({
      bots: telegramConns.map(toTelegramBotEntry),
    })
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getAllStatuses(): IMConnectionStatus[] {
    return this.manager.getAllStatuses().map(telegramStatusToIMStatus)
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

  private narrowOrigin(origin: SessionOrigin): TelegramOrigin {
    if (origin.source !== 'telegram') {
      throw new Error(`TelegramAdapter received non-telegram origin: ${origin.source}`)
    }
    return origin
  }
}
