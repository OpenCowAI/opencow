// SPDX-License-Identifier: Apache-2.0

/**
 * DiscordAdapter — wraps DiscordBotManager to conform to the IMAdapter interface.
 */

import type { IMAdapter } from '../messaging/adapter'
import type { DiscordBotManager } from './discordBotManager'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  DiscordConnection,
} from '../../../src/shared/types'
import type { DiscordOrigin } from '../messaging/types'
import { toDiscordBotEntry, discordStatusToIMStatus } from './converters'

export class DiscordAdapter implements IMAdapter {
  readonly platform = 'discord' as const

  constructor(private readonly manager: DiscordBotManager) {}

  async startAll(): Promise<void> { await this.manager.startAll() }
  stopAll(): void { this.manager.stopAll() }

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

  async syncWithSettings(connections: IMConnection[]): Promise<void> {
    const discordConns = connections.filter(
      (c): c is DiscordConnection => c.platform === 'discord',
    )
    await this.manager.syncWithSettings({
      bots: discordConns.map(toDiscordBotEntry),
    })
  }

  getAllStatuses(): IMConnectionStatus[] {
    return this.manager.getAllStatuses().map(discordStatusToIMStatus)
  }

  async handleAssistantMessage(origin: SessionOrigin, message: ManagedSessionMessage, sessionId: string): Promise<void> {
    await this.manager.handleAssistantMessage(this.narrowOrigin(origin), message, sessionId)
  }

  async handleEvoseProgress(origin: SessionOrigin, message: ManagedSessionMessage, sessionId: string): Promise<void> {
    await this.manager.handleEvoseProgress(this.narrowOrigin(origin), message, sessionId)
  }

  releaseActivePlaceholder(origin: SessionOrigin): void {
    this.manager.releaseActivePlaceholder(this.narrowOrigin(origin))
  }

  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    await this.manager.notifySessionDone(this.narrowOrigin(origin), stopReason)
  }

  // ── Origin narrowing ──────────────────────────────────────────────────────

  private narrowOrigin(origin: SessionOrigin): DiscordOrigin {
    if (origin.source !== 'discord') {
      throw new Error(`DiscordAdapter received non-discord origin: ${origin.source}`)
    }
    return origin
  }
}
