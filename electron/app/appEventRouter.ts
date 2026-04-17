// SPDX-License-Identifier: Apache-2.0

/**
 * AppEventRouter — centralized event routing for the main process.
 *
 * Replaces scattered `bus.onBroadcast()` registrations with a single,
 * declarative routing table.  Benefits:
 *
 *   1. **O(1) dispatch** — events are routed via Map lookup, not N if-checks
 *   2. **Error isolation** — each handler is wrapped in try/catch; one failure
 *      doesn't prevent subsequent handlers from running
 *   3. **Discoverability** — all event→handler mappings are visible in one place
 *   4. **Testability** — the router can be instantiated in tests with mock deps
 *
 * Design:
 *   - `wireEventRoutes()` is a pure function that takes dependencies and returns nothing.
 *   - It registers one `bus.onBroadcast` listener and one `bus.onStatusTransition` listener.
 *   - All handlers are async-safe: errors are logged, never propagated.
 */

import { nativeTheme } from 'electron'
import { isIMOrigin } from '../services/messaging'
import { configureMarketplaceFetch } from '../services/marketplace/utils/http'
import { createLogger } from '../platform/logger'
import type { DataBus } from '../core/dataBus'
import type { DataBusEvent, ThemeConfig, StatusTransition } from '../../src/shared/types'
import type { NotificationService } from '../services/notificationService'
import type { WebhookService } from '../services/webhooks/webhookService'
import type { InboxService } from '../services/inboxService'
import type { SessionOrchestrator } from '../command/sessionOrchestrator'
import type { ArtifactService } from '../services/artifactService'
import type { IMBridgeManager } from '../services/messaging'
import type { EventListener } from '../services/schedule/eventListener'
import type { ProxyFetchFactory } from '../network'
import type { GitService } from '../services/git/gitService'
import { SessionTransitionProjector } from './sessionTransitionProjector'
import { mapHookEventToEngineEvent } from '../events/engineEventMapper'
import { ManagedEngineEventProjector } from '../events/managedEngineEventProjector'

const log = createLogger('EventRouter')

// ── Types ────────────────────────────────────────────────────────────────────

export interface EventRouterDeps {
  bus: DataBus
  notificationService: NotificationService
  webhookService: WebhookService
  inboxService: InboxService
  orchestrator: SessionOrchestrator
  artifactService: ArtifactService
  imBridgeManager: IMBridgeManager
  proxyFetchFactory: ProxyFetchFactory
  eventListener: EventListener | null
  gitService: GitService | null
}

type AsyncEventHandler = (event: DataBusEvent) => Promise<void>

// ── Helpers ──────────────────────────────────────────────────────────────────

function toThemeSource(theme: ThemeConfig): 'system' | 'light' | 'dark' {
  return theme.mode === 'system' ? 'system' : theme.mode
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Wire all event routes onto the DataBus.
 *
 * MUST be called after all services are initialised (Phase 3) to prevent
 * historical hook-event replay from triggering webhooks/notifications.
 */
export function wireEventRoutes(deps: EventRouterDeps): void {
  const {
    bus,
    notificationService,
    webhookService,
    inboxService,
    orchestrator,
    artifactService,
    imBridgeManager,
    proxyFetchFactory,
    eventListener,
    gitService,
  } = deps

  const transitionProjector = new SessionTransitionProjector()
  const managedEngineEventProjector = new ManagedEngineEventProjector()

  function emitTransition(transition: StatusTransition): void {
    try {
      notificationService.onTransition(transition)
    } catch (err) {
      log.error('[transition] Notification handler error', err)
    }
    void webhookService.onTransition(transition).catch((err) => {
      log.error('[transition] Webhook handler error', err)
    })
  }

  function emitTransitions(transitions: StatusTransition[]): void {
    for (const transition of transitions) emitTransition(transition)
  }

  async function emitManagedEngineEvents(event: DataBusEvent): Promise<void> {
    const engineEvents = managedEngineEventProjector.project(event)
    for (const engineEvent of engineEvents) {
      await inboxService.onEngineEvent(engineEvent)
      await webhookService.onEngineEvent(engineEvent)
    }
  }

  // ── Status transition listeners ─────────────────────────────────────────
  // Keep hook-derived transitions for non-managed sessions, but skip managed
  // ones because those are now emitted from normalized command events.
  bus.onStatusTransition((transition) => {
    emitTransitions(transitionProjector.projectFromHookTransition(transition))
  })

  // ── Build event route table ─────────────────────────────────────────────
  const routeTable = new Map<string, AsyncEventHandler[]>()

  function on(eventType: string, handler: AsyncEventHandler): void {
    const handlers = routeTable.get(eventType) ?? []
    handlers.push(handler)
    routeTable.set(eventType, handlers)
  }

  // ── command:session:* → managed status transitions ──────────────────────
  on('command:session:created', async (event) => {
    if (event.type !== 'command:session:created') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  on('command:session:updated', async (event) => {
    if (event.type !== 'command:session:updated') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  on('command:session:idle', async (event) => {
    if (event.type !== 'command:session:idle') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  on('command:session:stopped', async (event) => {
    if (event.type !== 'command:session:stopped') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  on('command:session:error', async (event) => {
    if (event.type !== 'command:session:error') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  on('command:session:deleted', async (event) => {
    if (event.type !== 'command:session:deleted') return
    emitTransitions(transitionProjector.projectFromCommandEvent(event))
    await emitManagedEngineEvents(event)
  })

  // ── settings:updated ───────────────────────────────────────────────────
  on('settings:updated', async (event) => {
    if (event.type !== 'settings:updated') return
    nativeTheme.themeSource = toThemeSource(event.payload.theme)
    configureMarketplaceFetch(proxyFetchFactory.getStandardFetch())
    log.info('Settings side effects applied', {
      themeMode: event.payload.theme.mode,
    })
  })

  on('settings:updated', async (event) => {
    if (event.type !== 'settings:updated') return
    await imBridgeManager.syncWithSettings(event.payload)
  })

  // ── hooks:event ────────────────────────────────────────────────────────
  // Forward signal hook events to inbox + webhook services via normalized engine event.
  on('hooks:event', async (event) => {
    if (event.type !== 'hooks:event') return
    const engineEvent = mapHookEventToEngineEvent(event.payload)
    if (engineEvent) {
      await inboxService.onEngineEvent(engineEvent)
      await webhookService.onEngineEvent(engineEvent)
    }

    // Execution-context fallback from hook stream:
    // Hook payload may carry cwd updates for managed sessions. Feed those
    // into orchestrator so branch/worktree context stays fresh even when
    // engine runtime streams omit cwd-oriented events.
    const hookCwd = typeof event.payload.payload.cwd === 'string'
      ? event.payload.payload.cwd.trim()
      : ''
    const skipHookCwdIngestion = orchestrator.shouldSkipHookSourceEvent(event.payload.sessionId)
    if (hookCwd.length > 0 && !skipHookCwdIngestion) {
      orchestrator.ingestExecutionContextSignal(event.payload.sessionId, {
        cwd: hookCwd,
        source: 'hook',
        occurredAtMs: Date.parse(event.payload.timestamp),
      })
    }
  })

  // Artifact capture from monitor sessions (session_stop hook events)
  on('hooks:event', async (event) => {
    if (event.type !== 'hooks:event') return
    const hookPayload = event.payload.payload as Record<string, unknown>
    if (event.payload.eventType === 'session_stop' && hookPayload.transcript_path) {
      await artifactService.captureFromMonitorSession({
        sessionId: event.payload.sessionId,
        transcriptPath: hookPayload.transcript_path as string,
        projectId: null,
      })
    }
  })

  // ── command:session:idle ───────────────────────────────────────────────
  on('command:session:idle', async (event) => {
    if (event.type !== 'command:session:idle') return
    // Artifact capture at session boundaries (managed sessions)
    const session = await orchestrator.getFullSession(event.payload.sessionId)
    if (session) {
      await artifactService.captureFromManagedSession(session)
    }
  })

  on('command:session:idle', async (event) => {
    if (event.type !== 'command:session:idle') return
    // Release IM placeholder when session goes idle
    const { origin } = event.payload
    if (isIMOrigin(origin)) {
      imBridgeManager.releaseActivePlaceholder(origin)
    }
  })

  // ── command:session:idle — Git status refresh ───────────────────────────
  on('command:session:idle', async (event) => {
    if (event.type !== 'command:session:idle' || !gitService) return
    // Agent may have run git commands — refresh status for the session's cwd
    const session = await orchestrator.getSession(event.payload.sessionId)
    if (session) {
      const cwd = session.executionContext?.cwd ?? session.projectPath
      if (cwd) {
        await gitService.forceRefresh(cwd).catch((err) =>
          log.debug('Git refresh after session idle failed', err)
        )
      }
    }
  })

  // ── command:session:stopped ────────────────────────────────────────────
  on('command:session:stopped', async (event) => {
    if (event.type !== 'command:session:stopped') return
    const fullSession = await orchestrator.getFullSession(event.payload.sessionId)
    if (fullSession) {
      await artifactService.captureFromManagedSession(fullSession)
      // Refresh git status — session may have committed/modified files
      const cwd = fullSession.executionContext?.cwd ?? fullSession.projectPath
      if (cwd) {
        await gitService?.forceRefresh(cwd).catch((err) =>
          log.debug('Git refresh after session stopped failed', err)
        )
      }
    }
  })

  // ── command:session:message ────────────────────────────────────────────
  on('command:session:message', async (event) => {
    if (event.type !== 'command:session:message') return
    const { sessionId, origin, message, isRelayProgress } = event.payload
    if (isIMOrigin(origin) && message.role === 'assistant') {
      if (isRelayProgress) {
        await imBridgeManager.handleEvoseProgress(origin, message, sessionId)
      } else {
        await imBridgeManager.handleAssistantMessage(origin, message, sessionId)
      }
    }
  })

  // ── command:session:error ──────────────────────────────────────────────
  on('command:session:error', async (event) => {
    if (event.type !== 'command:session:error') return
    const { origin } = event.payload
    if (isIMOrigin(origin)) {
      imBridgeManager.releaseActivePlaceholder(origin)
    }
  })

  // ── Schedule EventListener (forward all events) ────────────────────────
  // The schedule engine's EventListener matches events against trigger rules.
  // This replaces the bare `bus.onBroadcast((e) => eventListener.handleEvent(e))`.
  // We register it as a catch-all in the broadcast listener below.

  // ── Mount single broadcast listener ────────────────────────────────────
  bus.onBroadcast(async (event) => {
    const startedAt = Date.now()
    let handledCount = 0

    // O(1) lookup for typed event handlers
    const handlers = routeTable.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event)
          handledCount += 1
        } catch (err) {
          log.error(`[${event.type}] Event handler error`, err)
        }
      }
    }

    // Schedule EventListener needs ALL events (not just specific types)
    if (eventListener) {
      try {
        await eventListener.handleEvent(event)
      } catch (err) {
        log.error('[Schedule] EventListener error', err)
      }
    }

    const durationMs = Date.now() - startedAt
    if (durationMs >= 1_000) {
      log.warn('Slow event routing detected', {
        eventType: event.type,
        durationMs,
        handledCount,
      })
    }
  })

  log.info(`Event router mounted: ${routeTable.size} event types, ${[...routeTable.values()].reduce((n, h) => n + h.length, 0)} handlers`)
}
