// SPDX-License-Identifier: Apache-2.0

/**
 * IMBridgeManager — unified multi-platform IM bridge management layer.
 *
 * Design principles:
 *
 *   1. Registry pattern — adapters register themselves via `registerAdapter()`.
 *      IMBridgeManager never references a specific platform directly.
 *      Adding a new platform requires zero changes to this file.
 *
 *   2. Unified event routing — main.ts event handlers call IMBridgeManager
 *      methods with the full SessionOrigin; the manager routes to the
 *      correct adapter by `origin.source`.
 *
 *   3. Single IPC surface — exposes only `messaging:*` IPC handlers.
 *
 *   4. Hot-update transparent — settings changes flow through syncWithSettings()
 *      which delegates to each adapter's own sync mechanism.
 */

import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  IMPlatformType,
  AppSettings,
} from '../../../src/shared/types'
import type { IMAdapter } from './adapter'
import type { IMBridgeManagerDeps } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('IMBridgeManager')

export class IMBridgeManager {
  /** Registered platform adapters, keyed by IMPlatformType. */
  private readonly adapters = new Map<IMPlatformType, IMAdapter>()

  /** Cache of all connections from the last settings sync (used for platform lookup). */
  private lastSyncedConnections: IMConnection[] = []

  constructor(private readonly deps: IMBridgeManagerDeps) {}

  // ─── Adapter registration ─────────────────────────────────────────────────

  /** Register a platform adapter. Called during application initialization. */
  registerAdapter(adapter: IMAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      log.warn('registerAdapter: overwriting existing adapter', { platform: adapter.platform })
    }
    this.adapters.set(adapter.platform, adapter)
    log.info('registerAdapter: registered', { platform: adapter.platform })
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start all enabled IM connections across all registered adapters. */
  async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.adapters.values()].map((a) => a.startAll()),
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const platform = [...this.adapters.keys()][i]
        log.error(`startAll: ${platform} adapter failed`, r.reason)
      }
    })
  }

  /** Stop all running IM connections across all registered adapters. */
  stopAll(): void {
    for (const adapter of this.adapters.values()) {
      adapter.stopAll()
    }
  }

  // ─── Unified event routing ─────────────────────────────────────────────────

  /**
   * Route an assistant message to the correct platform adapter.
   * Called by main.ts on `command:session:message` for IM-sourced sessions.
   */
  async handleAssistantMessage(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const adapter = this.adapters.get(origin.source as IMPlatformType)
    if (!adapter) {
      log.debug(`handleAssistantMessage: no adapter for source=${origin.source}`)
      return
    }
    await adapter.handleAssistantMessage(origin, message, sessionId)
  }

  /**
   * Route an Evose relay progress update to the correct platform adapter.
   */
  async handleEvoseProgress(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const adapter = this.adapters.get(origin.source as IMPlatformType)
    if (!adapter) return
    await adapter.handleEvoseProgress(origin, message, sessionId)
  }

  /**
   * Release the streaming placeholder for a chat.
   * Called on session idle/error to clean up stale placeholders.
   */
  releaseActivePlaceholder(origin: SessionOrigin): void {
    const adapter = this.adapters.get(origin.source as IMPlatformType)
    if (!adapter) return
    adapter.releaseActivePlaceholder(origin)
  }

  /**
   * Notify the originating chat that the session has completed.
   */
  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    const adapter = this.adapters.get(origin.source as IMPlatformType)
    if (!adapter) return
    await adapter.notifySessionDone(origin, stopReason)
  }

  // ─── Unified status ────────────────────────────────────────────────────────

  /** Aggregate status from all registered adapters into a flat list. */
  getAllStatuses(): IMConnectionStatus[] {
    const statuses: IMConnectionStatus[] = []
    for (const adapter of this.adapters.values()) {
      statuses.push(...adapter.getAllStatuses())
    }
    return statuses
  }

  // ─── Unified connection management ─────────────────────────────────────────

  /** Start a specific connection by its ID (routes to the correct adapter). */
  async startConnection(connectionId: string): Promise<boolean> {
    const adapter = this.findAdapterForConnection(connectionId)
    if (adapter) {
      await adapter.startConnection(connectionId)
      return true
    }
    log.warn('startConnection: connection not found in any adapter', { connectionId })
    return false
  }

  /** Stop a specific connection by its ID. */
  async stopConnection(connectionId: string): Promise<boolean> {
    const adapter = this.findAdapterForConnection(connectionId)
    if (adapter) {
      adapter.stopConnection(connectionId)
      return true
    }
    log.warn('stopConnection: connection not found in any adapter', { connectionId })
    return false
  }

  /** Test a specific connection (validates credentials without starting). */
  async testConnection(connectionId: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.findAdapterForConnection(connectionId)
    if (adapter) {
      return adapter.testConnection(connectionId)
    }
    return { success: false, error: `Connection ${connectionId} not found` }
  }

  // ─── Settings sync ─────────────────────────────────────────────────────────

  /** Sync all registered adapters with updated application settings. */
  async syncWithSettings(settings: AppSettings): Promise<void> {
    const connections = settings.messaging.connections
    this.lastSyncedConnections = connections

    // Group connections by platform and dispatch to each adapter
    const byPlatform = new Map<IMPlatformType, IMConnection[]>()
    for (const conn of connections) {
      const list = byPlatform.get(conn.platform) ?? []
      list.push(conn)
      byPlatform.set(conn.platform, list)
    }

    const results = await Promise.allSettled(
      [...this.adapters.entries()].map(([platform, adapter]) =>
        adapter.syncWithSettings(byPlatform.get(platform) ?? []),
      ),
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const platform = [...this.adapters.keys()][i]
        log.error(`syncWithSettings: ${platform} adapter failed`, r.reason)
      }
    })
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Find the adapter that owns a connection by checking each adapter's
   * hasConnection(), then falling back to the cached connections list.
   */
  private findAdapterForConnection(connectionId: string): IMAdapter | undefined {
    // Fast path: check live adapters
    for (const adapter of this.adapters.values()) {
      if (adapter.hasConnection(connectionId)) return adapter
    }
    // Slow path: look up platform from cached settings
    const platform = this.lastSyncedConnections.find((c) => c.id === connectionId)?.platform
    if (platform) return this.adapters.get(platform)
    return undefined
  }
}
