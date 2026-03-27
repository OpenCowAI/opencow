// SPDX-License-Identifier: Apache-2.0

/**
 * MemoryService — central orchestrator for the memory system.
 *
 * Responsibilities:
 *   - Subscribe to DataBus events and route to adapters
 *   - Debounce and extract memories via LLM
 *   - Run quality gate checks
 *   - Emit perception events for the renderer
 *   - Provide CRUD and search APIs for IPC handlers
 *   - Supply context injection for new sessions
 */

import { createLogger } from '../platform/logger'
import type { DataBus } from '../core/dataBus'
import type { IMemoryStorage } from './storage/types'
import { MemoryExtractor, type MemoryExtractorDeps } from './memoryExtractor'
import { MemoryQualityGate } from './memoryQualityGate'
import { MemoryRetriever, type MemoryContext, type SessionContextParams } from './memoryRetriever'
import { MemoryDebounceQueue } from './memoryDebounceQueue'
import { SessionInteractionAdapter } from './adapters/sessionAdapter'
import type { InteractionSourceAdapter, InteractionEvent } from './types'
import { MAX_EXTRACTIONS_PER_MINUTE, CLEANUP_INTERVAL_MS } from './constants'
import type { CandidateMemory } from './types'
import type { QualityGateResult } from './memoryQualityGate'
import type {
  MemoryItem,
  MemoryListParams,
  MemorySearchParams,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemorySettings,
  MemorySource,
  DataBusEvent,
} from '@shared/types'
import { MEMORY_LIMITS, MEMORY_DEFAULTS } from '@shared/types'

const log = createLogger('MemoryService')

// ─── Dependencies ──────────────────────────────────────────────────

export interface MemoryServiceDeps {
  bus: DataBus
  store: IMemoryStorage
  extractorDeps: MemoryExtractorDeps
  /** Optional adapter injection for testing. Defaults to [SessionInteractionAdapter]. */
  adapters?: InteractionSourceAdapter[]
  /** Resolve session messages for extraction. Returns concatenated user+assistant text. */
  getSessionContent?: (sessionId: string) => Promise<string | null>
}

// ─── MemoryService ─────────────────────────────────────────────────

export class MemoryService {
  private readonly store: IMemoryStorage
  private readonly extractor: MemoryExtractor
  private readonly qualityGate: MemoryQualityGate
  private readonly retriever: MemoryRetriever
  private readonly debounceQueue: MemoryDebounceQueue
  private readonly bus: DataBus
  private readonly adapters: InteractionSourceAdapter[]
  private readonly getSessionContent: ((sessionId: string) => Promise<string | null>) | null

  private unsubscribeBus: (() => void) | null = null
  private unsubscribeFlush: (() => void) | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  // Extraction concurrency: promise chain per key ensures serial execution
  private extractionChains = new Map<string, Promise<void>>()
  // Rate limiter (sliding window)
  private extractionTimestamps: number[] = []
  // Cached extraction delay (synced from settings for synchronous debounce access)
  private cachedExtractionDelayMs: number = MEMORY_DEFAULTS.extractionDelaySeconds * 1000

  constructor(deps: MemoryServiceDeps) {
    this.store = deps.store
    this.bus = deps.bus
    this.extractor = new MemoryExtractor(deps.extractorDeps)
    this.qualityGate = new MemoryQualityGate(deps.store)
    this.retriever = new MemoryRetriever(deps.store)
    this.debounceQueue = new MemoryDebounceQueue(
      () => this.getExtractionDelayMs(),
    )
    this.adapters = deps.adapters ?? [new SessionInteractionAdapter()]
    this.getSessionContent = deps.getSessionContent ?? null
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  initialize(): void {
    // Wire debounce flush — with proper error handling (no fire-and-forget)
    this.unsubscribeFlush = this.debounceQueue.addFlushListener((event) => {
      this.processExtraction(event).catch((err) => {
        log.error('Unhandled extraction pipeline error', err)
      })
    })

    // Subscribe to DataBus — with proper error handling
    this.unsubscribeBus = this.bus.onBroadcast((event: DataBusEvent) => {
      this.onDataBusEvent(event).catch((err) => {
        log.error('Failed to process DataBus event for memory', err)
      })
    })

    // Periodic expired memory cleanup
    this.cleanupTimer = setInterval(() => {
      this.store.cleanupExpired().catch((err) => {
        log.error('Expired memory cleanup failed', err)
      })
    }, CLEANUP_INTERVAL_MS)

    // Run initial cleanup
    this.store.cleanupExpired().catch((err) => {
      log.error('Initial expired memory cleanup failed', err)
    })

    log.info('MemoryService initialized')
  }

  dispose(): void {
    this.unsubscribeBus?.()
    this.unsubscribeBus = null
    this.unsubscribeFlush?.()
    this.unsubscribeFlush = null
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.debounceQueue.dispose()
    this.extractionChains.clear()
  }

  // ── DataBus Event Handler ────────────────────────────────────────

  private async onDataBusEvent(event: DataBusEvent): Promise<void> {
    const settings = await this.store.getSettings()
    if (!settings.enabled) return
    this.cachedExtractionDelayMs = (settings.extractionDelaySeconds ?? MEMORY_DEFAULTS.extractionDelaySeconds) * 1000

    const eventType = event.type
    const data = ('payload' in event ? event.payload : {}) as Record<string, unknown>

    for (const adapter of this.adapters) {
      if (!adapter.shouldProcess(eventType, data)) continue
      if (!settings.extractionSources.includes(adapter.sourceType)) continue

      const interactionEvent = adapter.toInteractionEvent(eventType, data)
      if (!interactionEvent) continue

      // Resolve content for session events (adapter returns empty placeholder)
      if (interactionEvent.type === 'session' && !interactionEvent.content && this.getSessionContent) {
        const content = await this.getSessionContent(interactionEvent.sessionId!)
        if (!content || content.length < 30) continue
        interactionEvent.content = content
      }

      if (interactionEvent.content) {
        this.debounceQueue.enqueue(interactionEvent)
      }
    }
  }

  // ── Rate Limiting (atomic check-and-record) ───────────────────

  /** Atomically check and acquire a rate limit slot. Returns true if allowed. */
  private tryAcquireExtractionSlot(): boolean {
    const now = Date.now()
    this.extractionTimestamps = this.extractionTimestamps.filter((t) => now - t < 60_000)
    if (this.extractionTimestamps.length >= MAX_EXTRACTIONS_PER_MINUTE) return false
    this.extractionTimestamps.push(now)
    return true
  }

  /** Synchronous read of extraction delay (ms), cached from last settings load. */
  private getExtractionDelayMs(): number {
    return this.cachedExtractionDelayMs
  }

  // ── Extraction Pipeline ──────────────────────────────────────────

  /**
   * Serialized extraction per key (projectId:sourceType).
   *
   * Chains new extractions onto the previous promise for the same key,
   * guaranteeing serial execution without race conditions.
   */
  private async processExtraction(event: InteractionEvent): Promise<void> {
    const lockKey = `${event.projectId ?? 'global'}:${event.type}`

    const prev = this.extractionChains.get(lockKey) ?? Promise.resolve()
    const next = prev.then(() => this.doProcessExtraction(event)).catch((err) => {
      log.error('Extraction chain failed for key', { lockKey, error: err instanceof Error ? err.message : String(err) })
    })
    this.extractionChains.set(lockKey, next)

    await next
  }

  private async doProcessExtraction(event: InteractionEvent): Promise<void> {
    try {
      const settings = await this.store.getSettings(event.projectId ?? undefined)
      if (!settings.enabled) return

      // Atomic rate limiting
      if (!this.tryAcquireExtractionSlot()) {
        log.warn('Memory extraction rate limited', { source: event.type })
        return
      }

      // 1. Fetch existing memories FIRST — so LLM can see them for merge decisions
      const existing = await this.store.list({
        scope: event.projectId ? 'project' : 'user',
        projectId: event.projectId ?? undefined,
        status: 'confirmed',
        limit: 100,
        sortBy: 'created_at',
        sortOrder: 'desc',
      })

      // 2. LLM extraction — pass existing memories for merge awareness
      const candidates = await this.extractor.extract(event, existing)
      if (candidates.length === 0) return

      // 3. Quality gate — routes to new or merge paths
      const { newCandidates, mergeCandidates } = await this.qualityGate.evaluate(candidates, existing)
      if (newCandidates.length === 0 && mergeCandidates.length === 0) return

      // 4a. Handle new memories
      const newItems = await this.saveNewCandidates(newCandidates, event)

      // 4b. Handle merge proposals
      const mergeProposals = await this.saveMergeProposals(mergeCandidates, event)

      // 5. Emit events or auto-confirm
      if (newItems.length > 0) {
        if (settings.autoConfirm) {
          for (const item of newItems) {
            await this.confirm(item.id, 'auto')
          }
        } else {
          this.bus.dispatch({
            type: 'memory:extracted',
            payload: { items: newItems, source: event.type as MemorySource },
          })
        }
      }

      if (mergeProposals.length > 0) {
        if (settings.autoConfirm) {
          for (const { pendingItem, target } of mergeProposals) {
            await this.confirmMerge(pendingItem.id, target.id)
          }
        } else {
          for (const { pendingItem, target } of mergeProposals) {
            this.bus.dispatch({
              type: 'memory:merge-proposed',
              payload: {
                pendingId: pendingItem.id,
                targetId: target.id,
                oldContent: target.content,
                newContent: pendingItem.content,
                category: target.category,
                source: event.type as MemorySource,
              },
            })
          }
        }
      }

      log.info('Memories extracted', {
        new: newItems.length,
        merge: mergeProposals.length,
        source: event.type,
        autoConfirmed: settings.autoConfirm,
      })
    } catch (err) {
      log.error('Memory extraction pipeline failed', err)
    }
  }

  private async saveNewCandidates(candidates: CandidateMemory[], event: InteractionEvent): Promise<MemoryItem[]> {
    const items: MemoryItem[] = []
    for (const candidate of candidates) {
      try {
        const item = await this.store.create({
          scope: candidate.scope,
          projectId: event.projectId,
          content: candidate.content,
          category: candidate.category,
          tags: candidate.tags,
          confidence: candidate.confidence,
          source: event.type,
          sourceId: event.sessionId,
          reasoning: candidate.reasoning,
        })
        items.push(item)
      } catch (err) {
        log.warn('Failed to create memory candidate', err)
      }
    }
    return items
  }

  private async saveMergeProposals(
    mergeCandidates: QualityGateResult['mergeCandidates'],
    event: InteractionEvent,
  ): Promise<Array<{ pendingItem: MemoryItem; target: MemoryItem }>> {
    const proposals: Array<{ pendingItem: MemoryItem; target: MemoryItem }> = []
    for (const { candidate, target } of mergeCandidates) {
      try {
        const pendingItem = await this.store.create({
          scope: candidate.scope,
          projectId: event.projectId,
          content: candidate.content,
          category: candidate.category,
          tags: candidate.tags,
          confidence: candidate.confidence,
          source: event.type,
          sourceId: event.sessionId,
          reasoning: candidate.reasoning,
        })
        proposals.push({ pendingItem, target })
      } catch (err) {
        log.warn('Failed to create merge proposal', err)
      }
    }
    return proposals
  }

  // ── CRUD ─────────────────────────────────────────────────────────

  async list(params: MemoryListParams): Promise<MemoryItem[]> {
    return this.store.list(params)
  }

  async get(id: string): Promise<MemoryItem | null> {
    return this.store.get(id)
  }

  async search(params: MemorySearchParams): Promise<MemoryItem[]> {
    return this.store.search(params)
  }

  async create(input: MemoryCreateInput): Promise<MemoryItem> {
    const item = await this.store.create(input)
    const confirmed = await this.store.confirm(item.id, 'user')
    if (!confirmed) {
      throw new Error(`Failed to confirm just-created memory: ${item.id}`)
    }
    return confirmed
  }

  async update(id: string, patch: MemoryUpdateInput): Promise<MemoryItem | null> {
    const item = await this.store.update(id, patch)
    if (item) {
      this.bus.dispatch({ type: 'memory:updated', payload: { item } })
    }
    return item
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id)
    this.bus.dispatch({ type: 'memory:deleted', payload: { id } })
  }

  async archive(id: string): Promise<void> {
    await this.store.archive(id)
  }

  async bulkDelete(ids: string[]): Promise<void> {
    await this.store.bulkDelete(ids)
  }

  async bulkArchive(ids: string[]): Promise<void> {
    await this.store.bulkArchive(ids)
  }

  // ── Perception ───────────────────────────────────────────────────

  async confirm(id: string, by: 'user' | 'auto'): Promise<MemoryItem> {
    const item = await this.store.confirm(id, by)
    if (!item) {
      throw new Error(`Memory not found: ${id}`)
    }
    this.bus.dispatch({ type: 'memory:confirmed', payload: { item, by } })
    return item
  }

  async reject(id: string): Promise<void> {
    await this.store.reject(id)
    this.bus.dispatch({ type: 'memory:rejected', payload: { id } })
  }

  async editAndConfirm(id: string, content: string): Promise<MemoryItem> {
    await this.store.update(id, { content })
    return this.confirm(id, 'user')
  }

  // ── Merge ─────────────────────────────────────────────────────────

  async confirmMerge(pendingId: string, targetId: string): Promise<MemoryItem> {
    const pending = await this.store.get(pendingId)
    if (!pending) throw new Error(`Pending merge memory not found: ${pendingId}`)

    const target = await this.store.get(targetId)
    if (!target) throw new Error(`Merge target memory not found: ${targetId}`)

    // Apply merge: update target with merged content, take higher confidence, combine tags
    const mergedTags = [...new Set([...target.tags, ...pending.tags])].slice(0, MEMORY_LIMITS.maxTags)
    const merged = await this.store.update(targetId, {
      content: pending.content,
      confidence: Math.max(target.confidence, pending.confidence),
      tags: mergedTags,
    })

    if (!merged) throw new Error(`Failed to update merge target: ${targetId}`)

    // Clean up the pending record
    await this.store.delete(pendingId)

    this.bus.dispatch({ type: 'memory:updated', payload: { item: merged } })

    return merged
  }

  async rejectMerge(pendingId: string): Promise<void> {
    await this.store.reject(pendingId)
    this.bus.dispatch({ type: 'memory:rejected', payload: { id: pendingId } })
  }

  // ── Context Injection ────────────────────────────────────────────

  async getContextForSession(params: SessionContextParams): Promise<MemoryContext> {
    const context = await this.retriever.getContextForSession(params)

    for (const m of context.memories) {
      await this.store.incrementAccess(m.id)
    }

    return context
  }

  // ── Stats & Settings ─────────────────────────────────────────────

  async getStats(projectId?: string): Promise<MemoryStats> {
    return this.store.getStats(projectId)
  }

  async getSettings(projectId?: string): Promise<MemorySettings> {
    return this.store.getSettings(projectId)
  }

  async updateSettings(projectId: string | null, settings: Partial<MemorySettings>): Promise<MemorySettings> {
    const updated = await this.store.updateSettings(projectId, settings)
    // Refresh cached extraction delay for synchronous debounce access
    if (projectId === null && updated.extractionDelaySeconds != null) {
      this.cachedExtractionDelayMs = updated.extractionDelaySeconds * 1000
    }
    return updated
  }

  // ── Export ───────────────────────────────────────────────────────

  async export(format: 'json' | 'markdown', scope?: 'user' | 'project'): Promise<string> {
    const memories = await this.store.list({
      scope,
      status: 'confirmed',
      sortBy: 'updated_at',
      sortOrder: 'asc',
      limit: 500,
    })

    if (format === 'json') {
      return JSON.stringify(
        {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          scope: scope ?? 'all',
          memories: memories.map((m) => ({
            content: m.content,
            category: m.category,
            tags: m.tags,
            confidence: m.confidence,
            source: m.source,
            scope: m.scope,
            createdAt: new Date(m.createdAt).toISOString(),
          })),
        },
        null,
        2,
      )
    }

    // Markdown format
    const lines: string[] = ['# OpenCow Memories']
    lines.push(`Exported: ${new Date().toISOString()}\n`)

    const grouped = new Map<string, MemoryItem[]>()
    for (const m of memories) {
      const key = m.category
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(m)
    }

    for (const [category, items] of grouped) {
      lines.push(`## ${category}`)
      for (const m of items) {
        lines.push(`- ${m.content} (confidence: ${m.confidence})`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}
