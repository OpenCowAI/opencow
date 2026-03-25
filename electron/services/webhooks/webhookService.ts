// SPDX-License-Identifier: Apache-2.0

import type {
  StatusTransition,
  EngineEventEnvelope,
  WebhookEndpoint,
  WebhookEventKind,
  WebhookTestResult,
  WebhookProviderType
} from '../../../src/shared/types'
import type { WebhookProvider, WebhookMessage } from './webhookProvider'
import { LarkProvider } from './larkProvider'
import { TelegramProvider } from './telegramProvider'
import { CustomProvider } from './customProvider'
import { createLogger } from '../../platform/logger'
import { createHash } from 'crypto'
import {
  webhookKindForEngineEventType,
  webhookKindForTransitionStatus,
} from '../../events/eventSignalCatalog'

const log = createLogger('Webhook')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000
const DEDUP_WINDOW_MS = 10_000
const DEDUP_PRUNE_INTERVAL_MS = 60_000

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface WebhookServiceParams {
  getEndpoints: () => WebhookEndpoint[]
  /**
   * Returns a proxy-aware fetch function for endpoints with `useProxy: true`.
   * For endpoints without proxy, `globalThis.fetch` is used directly.
   */
  getProxyFetch: () => typeof globalThis.fetch
}

export class WebhookService {
  private providers: Record<WebhookProviderType, WebhookProvider>
  private getEndpoints: () => WebhookEndpoint[]
  private getProxyFetch: () => typeof globalThis.fetch
  private recentSends = new Map<string, number>()
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  constructor(params: WebhookServiceParams) {
    this.getEndpoints = params.getEndpoints
    this.getProxyFetch = params.getProxyFetch
    this.providers = {
      lark: new LarkProvider(),
      telegram: new TelegramProvider(),
      custom: new CustomProvider()
    }
    // Periodically clean up dedup map to prevent memory leaks
    this.pruneTimer = setInterval(() => this.pruneDedup(), DEDUP_PRUNE_INTERVAL_MS)
  }

  /** Clean up resources. */
  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
  }

  // -----------------------------------------------------------------------
  // Event handlers (wired to DataBus in main.ts)
  // -----------------------------------------------------------------------

  /** Handle session status transitions (completed / error / waiting). */
  async onTransition(transition: StatusTransition): Promise<void> {
    const eventKind = webhookKindForTransitionStatus(transition.newStatus)
    if (!eventKind) return

    const message: WebhookMessage = {
      eventId: buildTransitionEventId(transition),
      title: titleForEvent(eventKind),
      body: bodyForTransition(transition, eventKind),
      sessionId: transition.sessionId,
      sessionName: transition.sessionName,
      eventKind,
      timestamp: transition.timestamp
    }

    await this.dispatch(message)
  }

  /** Handle normalized engine events (session_start / task_completed / notification). */
  async onEngineEvent(event: EngineEventEnvelope): Promise<void> {
    const eventKind = webhookKindForEngineEventType(event.eventType)
    if (!eventKind) return

    const message: WebhookMessage = {
      eventId: event.eventId,
      title: titleForEvent(eventKind),
      body: bodyForEngineEvent(event, eventKind),
      sessionId: event.sessionRef,
      sessionName:
        (event.payload.session_name as string)
        ?? (event.payload.session_id as string)
        ?? event.sessionRef,
      eventKind,
      timestamp: event.occurredAtMs || Date.now(),
      metadata: event.payload
    }

    await this.dispatch(message)
  }

  // -----------------------------------------------------------------------
  // Test endpoint
  // -----------------------------------------------------------------------

  /** Send a test message to a specific endpoint. */
  async testEndpoint(endpoint: WebhookEndpoint): Promise<WebhookTestResult> {
    const provider = this.providers[endpoint.provider]
    if (!provider) {
      return { success: false, error: `Unknown provider: ${endpoint.provider}`, durationMs: 0 }
    }

    const start = Date.now()
    try {
      const fetchFn = this.getFetchForEndpoint(endpoint)
      const result = await provider.sendTest(endpoint, fetchFn)
      return {
        success: result.statusCode >= 200 && result.statusCode < 300,
        statusCode: result.statusCode,
        durationMs: Date.now() - start
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal: dispatch + dedup + retry
  // -----------------------------------------------------------------------

  private async dispatch(message: WebhookMessage): Promise<void> {
    const endpoints = this.getEndpoints()
    const matching = endpoints.filter(
      (ep) => ep.enabled && ep.subscribedEvents.includes(message.eventKind)
    )
    if (matching.length === 0) return

    // Fire-and-forget all webhook sends in parallel; never throw to callers
    await Promise.allSettled(
      matching.map((ep) => {
        if (this.isDuplicate(ep.id, message)) return Promise.resolve()
        return this.sendWithRetry(ep, message)
      })
    )
  }

  /** Select the appropriate fetch function based on the endpoint's proxy setting. */
  private getFetchForEndpoint(endpoint: WebhookEndpoint): typeof globalThis.fetch {
    return endpoint.useProxy ? this.getProxyFetch() : globalThis.fetch
  }

  private async sendWithRetry(endpoint: WebhookEndpoint, message: WebhookMessage): Promise<void> {
    const provider = this.providers[endpoint.provider]
    if (!provider) return

    const fetchFn = this.getFetchForEndpoint(endpoint)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await provider.send(endpoint, message, fetchFn)

        if (result.statusCode >= 200 && result.statusCode < 300) {
          return // success
        }

        // 4xx = client error → do not retry
        if (result.statusCode >= 400 && result.statusCode < 500) {
          log.error(`Client error ${result.statusCode} sending to "${endpoint.name}"`)
          return
        }

        // 5xx or other → retry
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * (attempt + 1))
        }
      } catch (err) {
        // Network error / timeout → log without leaking secrets
        log.error(`Error sending to "${endpoint.name}" (attempt ${attempt + 1})`, err instanceof Error ? err.message : String(err))
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * (attempt + 1))
        }
      }
    }
    log.error(`Failed to send to "${endpoint.name}" after ${MAX_RETRIES + 1} attempts`)
  }

  // -----------------------------------------------------------------------
  // Dedup
  // -----------------------------------------------------------------------

  private isDuplicate(endpointId: string, message: WebhookMessage): boolean {
    const key = dedupKeyForMessage(endpointId, message)
    const lastSent = this.recentSends.get(key)
    const now = Date.now()
    if (lastSent && now - lastSent < DEDUP_WINDOW_MS) return true
    this.recentSends.set(key, now)
    return false
  }

  private pruneDedup(): void {
    const cutoff = Date.now() - DEDUP_WINDOW_MS * 2
    for (const [key, ts] of this.recentSends) {
      if (ts < cutoff) this.recentSends.delete(key)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure functions, easy to test)
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dedupKeyForMessage(endpointId: string, message: WebhookMessage): string {
  if (typeof message.eventId === 'string' && message.eventId.length > 0) {
    return `${endpointId}:event:${message.eventId}`
  }
  return `${endpointId}:legacy:${message.eventKind}:${message.sessionId}`
}

function buildTransitionEventId(transition: StatusTransition): string {
  const basis = JSON.stringify({
    sessionId: transition.sessionId,
    previousStatus: transition.previousStatus,
    newStatus: transition.newStatus,
    timestamp: transition.timestamp,
  })
  const digest = createHash('sha256').update(basis).digest('hex').slice(0, 24)
  return `transition:${digest}`
}

function titleForEvent(kind: WebhookEventKind): string {
  const titles: Record<WebhookEventKind, string> = {
    session_complete: 'Session Completed',
    session_error: 'Session Error',
    session_waiting: 'Attention Required',
    session_start: 'Session Started',
    task_completed: 'Task Completed',
    notification: 'Notification'
  }
  return `OpenCow \u2014 ${titles[kind]}`
}

function bodyForTransition(t: StatusTransition, kind: WebhookEventKind): string {
  const formats: Record<WebhookEventKind, (name: string) => string> = {
    session_complete: (n) => `\u201c${n}\u201d has finished`,
    session_error: (n) => `\u201c${n}\u201d encountered an error`,
    session_waiting: (n) => `\u201c${n}\u201d is waiting for input`,
    session_start: (n) => `\u201c${n}\u201d has started`,
    task_completed: (n) => `A task in \u201c${n}\u201d has completed`,
    notification: (n) => `Notification from \u201c${n}\u201d`
  }
  return formats[kind](t.sessionName)
}

function bodyForEngineEvent(event: EngineEventEnvelope, kind: WebhookEventKind): string {
  if (kind === 'task_completed') {
    const subject = (event.payload as Record<string, unknown>).task_subject as string | undefined
    return subject ? `Task completed: \u201c${subject}\u201d` : 'A task has completed'
  }
  if (kind === 'notification') {
    const title = (event.payload as Record<string, unknown>).title as string | undefined
    const msg = (event.payload as Record<string, unknown>).message as string | undefined
    return msg ?? title ?? 'Notification received'
  }
  return `Event: ${event.rawEventName}`
}
