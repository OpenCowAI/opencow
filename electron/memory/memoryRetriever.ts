// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '../platform/logger'
import type { IMemoryStorage } from './storage/types'
import type { MemoryItem } from '@shared/types'
import {
  HALF_LIFE_DAYS,
  DEFAULT_TOKEN_BUDGET,
  PER_ITEM_TOKEN_OVERHEAD,
  HEADER_TOKEN_ESTIMATE,
  PROJECT_SCOPE_BOOST,
  SCORE_WEIGHT_CONFIDENCE,
  SCORE_WEIGHT_RECENCY,
  SCORE_WEIGHT_USAGE,
  SCORE_WEIGHT_SCOPE,
} from './constants'

const log = createLogger('MemoryRetriever')

/** Rough token estimation: 1 token ~ 4 characters. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ─── Temporal Decay ────────────────────────────────────────────────

function temporalDecayFactor(createdAt: number, lastAccessedAt: number | null): number {
  const referenceTime = lastAccessedAt ?? createdAt
  const ageInDays = (Date.now() - referenceTime) / (1000 * 60 * 60 * 24)
  const lambda = Math.LN2 / HALF_LIFE_DAYS
  return Math.exp(-lambda * ageInDays)
}

// ─── Types ─────────────────────────────────────────────────────────

interface RankedMemory {
  memory: MemoryItem
  score: number
}

export interface MemoryContext {
  memories: MemoryItem[]
  tokenCount: number
  formatted: string
}

export interface SessionContextParams {
  projectId: string | null
  sessionType?: string
  userQuery?: string
  tokenBudget?: number
}

// ─── MemoryRetriever ───────────────────────────────────────────────

/**
 * Retrieves and formats memories for injection into session prompts.
 *
 * Strategy:
 * 1. Query project-level memories (boosted)
 * 2. Query user-level memories
 * 3. Merge, deduplicate, rank by composite score
 * 4. Fill within token budget
 * 5. Format as XML section for system prompt
 */
export class MemoryRetriever {
  constructor(private readonly store: IMemoryStorage) {}

  async getContextForSession(params: SessionContextParams): Promise<MemoryContext> {
    const budget = params.tokenBudget ?? DEFAULT_TOKEN_BUDGET
    log.debug('getContextForSession', { projectId: params.projectId, budget })

    // 1. Fetch project memories (only when a project is associated)
    const projectMemories = params.projectId
      ? await this.store.search({
          scope: 'project',
          projectId: params.projectId,
          query: params.userQuery ?? '',
          status: 'confirmed',
          limit: 20,
        })
      : []

    // 2. Fetch user memories (always — user-scope memories apply to all sessions)
    const userMemories = await this.store.search({
      scope: 'user',
      query: params.userQuery ?? '',
      status: 'confirmed',
      limit: 20,
    })

    log.debug('memories fetched', { projectCount: projectMemories.length, userCount: userMemories.length })

    // 3. Merge and rank
    const ranked = this.mergeAndRank(projectMemories, userMemories)

    // 4. Fill by token budget
    return this.fillByBudget(ranked, budget)
  }

  private mergeAndRank(projectMemories: MemoryItem[], userMemories: MemoryItem[]): RankedMemory[] {
    const ranked: RankedMemory[] = []

    for (const m of projectMemories) {
      ranked.push({
        memory: m,
        score: this.computeScore(m, PROJECT_SCOPE_BOOST),
      })
    }

    // User memories: skip if project already covers same (category, first-tag).
    // Only dedup when both have a non-empty first tag to avoid false positives.
    const projectTopics = new Set(
      projectMemories
        .filter((m) => m.tags.length > 0)
        .map((m) => `${m.category}:${m.tags[0]}`),
    )
    for (const m of userMemories) {
      if (m.tags.length > 0 && projectTopics.has(`${m.category}:${m.tags[0]}`)) continue
      ranked.push({
        memory: m,
        score: this.computeScore(m, 1.0),
      })
    }

    return ranked.sort((a, b) => b.score - a.score)
  }

  private computeScore(m: MemoryItem, scopeBoost: number): number {
    const confidenceScore = m.confidence
    const recencyScore = temporalDecayFactor(m.createdAt, m.lastAccessedAt)
    const usageScore = Math.min(m.accessCount / 10, 1.0)

    return (
      confidenceScore * SCORE_WEIGHT_CONFIDENCE +
      recencyScore * SCORE_WEIGHT_RECENCY +
      usageScore * SCORE_WEIGHT_USAGE +
      scopeBoost * SCORE_WEIGHT_SCOPE
    )
  }

  private fillByBudget(ranked: RankedMemory[], budget: number): MemoryContext {
    const selected: MemoryItem[] = []
    let usedTokens = 0

    for (const { memory } of ranked) {
      const tokens = estimateTokens(memory.content) + PER_ITEM_TOKEN_OVERHEAD
      if (usedTokens + tokens + HEADER_TOKEN_ESTIMATE > budget) break
      selected.push(memory)
      usedTokens += tokens
    }

    const formatted = this.formatForInjection(selected)

    log.debug('Memory context built', {
      total: ranked.length,
      selected: selected.length,
      tokens: usedTokens + HEADER_TOKEN_ESTIMATE,
    })

    return {
      memories: selected,
      tokenCount: usedTokens + HEADER_TOKEN_ESTIMATE,
      formatted,
    }
  }

  private formatForInjection(memories: MemoryItem[]): string {
    if (memories.length === 0) return ''

    const userMemories = memories.filter((m) => m.scope === 'user')
    const projectMemories = memories.filter((m) => m.scope === 'project')

    const lines: string[] = ['<opencow-memory>']

    if (userMemories.length > 0) {
      lines.push('## User Profile')
      for (const m of userMemories) {
        lines.push(`- [${m.category}] ${m.content}`)
      }
      lines.push('')
    }

    if (projectMemories.length > 0) {
      lines.push('## Project Context')
      for (const m of projectMemories) {
        lines.push(`- [${m.category}] ${m.content}`)
      }
      lines.push('')
    }

    lines.push('</opencow-memory>')
    return lines.join('\n')
  }
}
