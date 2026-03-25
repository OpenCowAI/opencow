// SPDX-License-Identifier: Apache-2.0

/**
 * FeishuAdapter — wraps FeishuBotManager to conform to the IMAdapter interface.
 */

import type { IMAdapter } from '../messaging/adapter'
import type { FeishuBotManager } from './feishuBotManager'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  FeishuConnection,
} from '../../../src/shared/types'
import type { FeishuOrigin } from '../messaging/types'
import { toFeishuBotEntry, feishuStatusToIMStatus } from './converters'

export class FeishuAdapter implements IMAdapter {
  readonly platform = 'feishu' as const

  constructor(private readonly manager: FeishuBotManager) {}

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
    const feishuConns = connections.filter(
      (c): c is FeishuConnection => c.platform === 'feishu',
    )
    await this.manager.syncWithSettings({
      bots: feishuConns.map(toFeishuBotEntry),
    })
  }

  getAllStatuses(): IMConnectionStatus[] {
    return this.manager.getAllStatuses().map(feishuStatusToIMStatus)
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

  private narrowOrigin(origin: SessionOrigin): FeishuOrigin {
    if (origin.source !== 'feishu') {
      throw new Error(`FeishuAdapter received non-feishu origin: ${origin.source}`)
    }
    return origin
  }
}
