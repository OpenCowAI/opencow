// SPDX-License-Identifier: Apache-2.0

/**
 * IMAdapter — unified interface for all IM platform adapters.
 *
 * Every platform (Telegram, Feishu, Discord, WeChat) implements this interface.
 * IMBridgeManager routes to the correct adapter via a Map<IMPlatformType, IMAdapter>
 * registry, eliminating hard-coded platform references (Open-Closed Principle).
 *
 * Design constraints:
 *   - `syncWithSettings()` receives only connections for THIS platform
 *     (filtering is done by IMBridgeManager before calling).
 *   - `handleAssistantMessage()` / `handleEvoseProgress()` receive the full
 *     SessionOrigin; the adapter narrows it internally.
 *   - Status methods return the unified `IMConnectionStatus` format directly
 *     (no intermediate platform-specific status types leak out).
 */

import type {
  SessionOrigin,
  ManagedSessionMessage,
  IMConnection,
  IMConnectionStatus,
  IMPlatformType,
} from '../../../src/shared/types'

export interface IMAdapter {
  /** Platform identifier — used as the registry key in IMBridgeManager. */
  readonly platform: IMPlatformType

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start all enabled connections. Failures are isolated per-connection. */
  startAll(): Promise<void>

  /** Stop all running connections synchronously. */
  stopAll(): void

  // ── Connection management ─────────────────────────────────────────────────

  /** Check whether a connection ID belongs to this adapter. */
  hasConnection(connectionId: string): boolean

  /** Start a specific connection by ID. */
  startConnection(connectionId: string): Promise<void>

  /** Stop a specific connection by ID. */
  stopConnection(connectionId: string): void

  /** Test connection credentials without starting. */
  testConnection(connectionId: string): Promise<{ success: boolean; error?: string }>

  // ── Settings sync ─────────────────────────────────────────────────────────

  /**
   * Sync this adapter with updated connections from application settings.
   * Only connections matching this adapter's platform are passed in.
   */
  syncWithSettings(connections: IMConnection[]): Promise<void>

  // ── Status ────────────────────────────────────────────────────────────────

  /** Return runtime statuses for all connections managed by this adapter. */
  getAllStatuses(): IMConnectionStatus[]

  // ── Message routing ───────────────────────────────────────────────────────

  /** Route an assistant message to the connection that owns the session. */
  handleAssistantMessage(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void>

  /** Route an Evose relay progress update to the correct connection. */
  handleEvoseProgress(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void>

  /** Release the streaming placeholder for a chat (cleanup on session end). */
  releaseActivePlaceholder(origin: SessionOrigin): void

  /** Notify the chat that the session has completed. */
  notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void>
}
