// SPDX-License-Identifier: Apache-2.0

/**
 * AppShutdown — graceful shutdown sequence for the main process.
 *
 * Encapsulates the entire shutdown flow:
 *   1. Stop synchronous sources (hookSource, statsSource, taskSource, etc.)
 *   2. Async disposal sequence (orchestrator → nativeCapabilities → browser → terminal → database)
 *   3. Force-exit safety net (8s timeout prevents hanging forever)
 *
 * Design:
 *   - All disposable references are passed via `ShutdownDeps` (no module-level state)
 *   - Sync stops run immediately; async disposal is awaited with a timeout
 *   - The `isShuttingDown` guard is the caller's responsibility (main.ts)
 */

import { app, BrowserWindow } from 'electron'
import { createLogger, shutdownLogger } from '../platform/logger'
import type { TrayManager } from '../tray'
import type { HookSource } from '../sources/hookSource'
import type { StatsSource } from '../sources/statsSource'
import type { TaskSource } from '../sources/taskSource'
import type { InboxService } from '../services/inboxService'
import type { WebhookService } from '../services/webhooks/webhookService'
import type { TelegramBotManager } from '../services/telegramBot/telegramBotManager'
import type { TimeResolver } from '../services/schedule/timeResolver'
import type { RetryScheduler } from '../services/schedule/retryScheduler'
import type { NativeCapabilityRegistry } from '../nativeCapabilities/registry'
import type { CapabilityCenter } from '../services/capabilityCenter'
import type { BrowserService } from '../browser/browserService'
import type { TerminalService } from '../terminal/terminalService'
import type { SessionOrchestrator } from '../command/sessionOrchestrator'
import type { DatabaseService } from '../database/db'
import type { GitService } from '../services/git/gitService'

const log = createLogger('Shutdown')

/** Hard timeout — force-quit if graceful shutdown takes too long. */
const SHUTDOWN_TIMEOUT_MS = 8_000

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShutdownDeps {
  trayManager: TrayManager

  // Synchronous stop targets (fire-and-forget)
  hookSource: HookSource
  statsSource: StatsSource
  taskSource: TaskSource
  inboxService: InboxService | null
  webhookService: WebhookService
  telegramBotManager: TelegramBotManager
  timeResolver: TimeResolver | null
  retryScheduler: RetryScheduler | null
  gitService: GitService | null
  issueSyncEngine: import('../services/issue-sync/syncEngine').IssueSyncEngine | null
  pushEngine: import('../services/issue-sync/pushEngine').PushEngine | null

  // Async disposal targets (awaited in order)
  nativeCapabilityRegistry: NativeCapabilityRegistry
  capabilityCenter: CapabilityCenter | null
  browserService: BrowserService | null
  terminalService: TerminalService | null
  orchestrator: SessionOrchestrator | null
  database: DatabaseService | null
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Execute the graceful shutdown sequence.
 *
 * This function does NOT return — it always ends by calling `app.quit()` or `app.exit()`.
 *
 * Steps:
 *   1. Start force-exit timer (8s safety net)
 *   2. Synchronously stop all sources and lightweight services
 *   3. Await async disposal (orchestrator → nativeCapabilities → browser → terminal → database)
 *   4. Force-exit (destroy windows, tray, logger, then quit)
 */
export function executeShutdown(deps: ShutdownDeps): void {
  const {
    trayManager,
    hookSource,
    statsSource,
    taskSource,
    inboxService,
    webhookService,
    telegramBotManager,
    timeResolver,
    retryScheduler,
    gitService,
    nativeCapabilityRegistry,
    capabilityCenter,
    browserService,
    terminalService,
    orchestrator,
    database,
  } = deps

  // Step 1: Safety timeout
  const forceQuitTimer = setTimeout(() => {
    log.warn('Graceful shutdown timed out — forcing exit')
    trayManager.destroy()
    shutdownLogger()
    app.exit(0)
  }, SHUTDOWN_TIMEOUT_MS)

  // Step 2: Synchronous stops (non-blocking, best-effort)
  hookSource.stop()
  statsSource.stop()
  taskSource.stop()
  inboxService?.stop()
  webhookService.stop()
  telegramBotManager.stopAll()
  timeResolver?.stop()
  retryScheduler?.cancelAll()
  gitService?.shutdown()
  deps.issueSyncEngine?.stop()
  deps.pushEngine?.stop()

  // Step 3: Async disposal sequence
  const shutdownSequence = async (): Promise<void> => {
    if (orchestrator) await orchestrator.shutdown()
    await nativeCapabilityRegistry.disposeAll()
    capabilityCenter?.dispose()
    if (browserService) await browserService.dispose()
    if (terminalService) terminalService.killAll()
    if (database) await database.close()
  }

  // Step 4: Force-exit after disposal (or on error)
  const forceExit = (): void => {
    clearTimeout(forceQuitTimer)
    BrowserWindow.getAllWindows().forEach((w) => w.destroy())
    trayManager.destroy()
    shutdownLogger()
    app.quit()
  }

  shutdownSequence()
    .then(() => forceExit())
    .catch((err) => {
      log.error('Error during shutdown', err)
      forceExit()
    })
}
