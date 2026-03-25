// SPDX-License-Identifier: Apache-2.0

/**
 * BaseBotManager<TEntry, TService, TStatus, TSettings, TOrigin>
 *
 * Generic base class that captures the shared lifecycle, configuration sync,
 * status query, and message routing logic across all IM platform managers.
 *
 * Subclasses only implement 3 abstract methods:
 *   - createService(entryId)      — factory for the platform-specific service
 *   - getOriginConnectionId(origin) — extract the routing key from an origin
 *   - isRestartRequired(old, new) — detect credential-level changes
 *
 * Design invariants:
 *   1. `entries` is the single source of truth for configuration.
 *      Services receive a `getConfig()` closure that reads from this map,
 *      so hot-updatable fields take effect without restart.
 *
 *   2. `syncWithSettings()` is serialised — concurrent calls are queued,
 *      preventing race conditions from rapid Settings saves.
 *
 *   3. Failures in one bot never prevent others from starting or stopping.
 */

import type { SessionOrigin, ManagedSessionMessage } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('BaseBotManager')

// ── Constraints on type parameters ──────────────────────────────────────────

/** Minimum shape every platform's BotEntry must conform to. */
export interface BaseBotEntry {
  id: string
  name: string
  enabled: boolean
}

/** Minimum shape every platform's BotService must conform to. */
export interface BaseBotService {
  start(): Promise<void>
  stop(): void
  testConnection(): Promise<{ success: boolean; error?: string }>
  getStatus(): unknown
  handleAssistantMessage(origin: SessionOrigin, message: ManagedSessionMessage, sessionId: string): Promise<void>
  handleEvoseProgress(origin: SessionOrigin, message: ManagedSessionMessage, sessionId: string): Promise<void>
  releaseActivePlaceholder(origin: SessionOrigin): void
  notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void>
}

/** Minimum shape for the settings container. */
export interface BaseBotSettings<TEntry extends BaseBotEntry> {
  bots: TEntry[]
}

// ── Base class ──────────────────────────────────────────────────────────────

export abstract class BaseBotManager<
  TEntry extends BaseBotEntry,
  TService extends BaseBotService,
  TStatus,
  TOrigin extends SessionOrigin,
> {
  protected readonly entries = new Map<string, TEntry>()
  protected readonly services = new Map<string, TService>()

  /** Serialises concurrent syncWithSettings calls. */
  private syncLock: Promise<void> = Promise.resolve()

  // ── Initialisation ────────────────────────────────────────────────────────

  /** Seed the entries map from persisted settings before calling `startAll()`. */
  init(settings: BaseBotSettings<TEntry>): void {
    for (const entry of settings.bots) {
      this.entries.set(entry.id, entry)
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async startAll(): Promise<void> {
    const enabledIds = [...this.entries.values()]
      .filter((e) => e.enabled)
      .map((e) => e.id)

    const results = await Promise.allSettled(enabledIds.map((id) => this.startBot(id)))
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        log.error(`startAll: failed to start bot ${enabledIds[i]}`, result.reason)
      }
    })
  }

  stopAll(): void {
    for (const [id] of this.services) {
      this.stopBot(id)
    }
  }

  async startBot(botId: string): Promise<void> {
    const entry = this.entries.get(botId)
    if (!entry) {
      log.warn('startBot: entry not found', { botId })
      return
    }

    let service = this.services.get(botId)
    if (!service) {
      service = this.createService(botId)
      this.services.set(botId, service)
    }

    await service.start()
  }

  stopBot(botId: string): void {
    const service = this.services.get(botId)
    if (!service) return
    service.stop()
    this.services.delete(botId)
  }

  // ── Configuration sync (serialised) ────────────────────────────────────

  async syncWithSettings(newSettings: BaseBotSettings<TEntry>): Promise<void> {
    this.syncLock = this.syncLock.then(() => this.doSync(newSettings))
    return this.syncLock
  }

  private async doSync(newSettings: BaseBotSettings<TEntry>): Promise<void> {
    const newEntries = new Map(newSettings.bots.map((e) => [e.id, e]))

    // Remove entries no longer present
    for (const [id] of this.services) {
      if (!newEntries.has(id)) {
        this.stopBot(id)
        this.entries.delete(id)
        log.info('syncWithSettings: removed bot', { botId: id })
      }
    }

    // Process each new/updated entry
    for (const [id, newEntry] of newEntries) {
      const oldEntry = this.entries.get(id)
      this.entries.set(id, newEntry)

      const isNew = !oldEntry
      const needsRestart = !!oldEntry && this.isRestartRequired(oldEntry, newEntry)

      if (isNew || needsRestart) {
        if (needsRestart) {
          log.info('syncWithSettings: credential changed, restarting bot', { botId: id })
          this.stopBot(id)
        }
        if (newEntry.enabled) {
          await this.startBot(id)
        }
        continue
      }

      // Hot-update path: only act on the enabled toggle
      const wasEnabled = oldEntry.enabled
      if (!wasEnabled && newEntry.enabled) {
        await this.startBot(id)
      } else if (wasEnabled && !newEntry.enabled) {
        this.stopBot(id)
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  hasConnection(connectionId: string): boolean {
    return this.entries.has(connectionId)
  }

  getStatus(botId: string): TStatus | null {
    return (this.services.get(botId)?.getStatus() as TStatus) ?? null
  }

  getAllStatuses(): TStatus[] {
    return [...this.services.values()].map((s) => s.getStatus() as TStatus)
  }

  async testBot(botId: string): Promise<{ success: boolean; error?: string }> {
    const service = this.services.get(botId)
    if (service) return service.testConnection()

    const entry = this.entries.get(botId)
    if (!entry) return { success: false, error: `Bot ${botId} not found` }

    const tempService = this.createService(botId)
    return tempService.testConnection()
  }

  // ── Message routing ─────────────────────────────────────────────────────

  async handleAssistantMessage(
    origin: TOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const service = this.services.get(this.getOriginConnectionId(origin))
    if (!service) {
      log.warn('handleAssistantMessage: bot not found', { connectionId: this.getOriginConnectionId(origin) })
      return
    }
    await service.handleAssistantMessage(origin, message, sessionId)
  }

  async handleEvoseProgress(
    origin: TOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const service = this.services.get(this.getOriginConnectionId(origin))
    if (!service) return
    await service.handleEvoseProgress(origin, message, sessionId)
  }

  releaseActivePlaceholder(origin: TOrigin): void {
    this.services.get(this.getOriginConnectionId(origin))?.releaseActivePlaceholder(origin)
  }

  async notifySessionDone(origin: TOrigin, stopReason?: string): Promise<void> {
    const service = this.services.get(this.getOriginConnectionId(origin))
    if (!service) return
    await service.notifySessionDone(origin, stopReason)
  }

  // ── Abstract methods (subclass must implement) ──────────────────────────

  /** Factory method — create a platform-specific BotService instance. */
  protected abstract createService(entryId: string): TService

  /** Extract the connection routing key from a platform-specific origin. */
  protected abstract getOriginConnectionId(origin: TOrigin): string

  /** Return true if the credential/token change between old and new entry requires a restart. */
  protected abstract isRestartRequired(oldEntry: TEntry, newEntry: TEntry): boolean
}
