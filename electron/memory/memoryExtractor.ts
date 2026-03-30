// SPDX-License-Identifier: Apache-2.0

/**
 * MemoryExtractor — extracts structured memories from interaction events.
 *
 * Uses a HeadlessLLMClient (Vercel AI SDK) for single-turn text generation.
 * The client is engine-agnostic — it automatically uses whichever LLM engine
 * (Claude / Codex) the user has configured in Settings.
 */

import { createLogger } from '../platform/logger'
import { buildExtractionPrompt, type ExtractionPromptParams } from './prompts/extractionPrompt'
import type { InteractionEvent, CandidateMemory, CandidateAction } from './types'
import type { MemoryItem, MemoryScope } from '@shared/types'
import { MEMORY_LIMITS } from '@shared/types'
import { clampConfidence, isValidMemoryCategory, isValidMemoryScope } from './validation'
import { MAX_EXISTING_MEMORIES_IN_PROMPT, EXTRACTION_TIMEOUT_MS, MIN_PRE_FILTER_CONTENT_LENGTH, MAX_PRE_FILTER_CONTENT_LENGTH } from './constants'
import type { HeadlessLLMClient } from '../llm/types'

const log = createLogger('MemoryExtractor')

// ─── Dependencies ──────────────────────────────────────────────────

export interface MemoryExtractorDeps {
  llmClient: HeadlessLLMClient
}

// ─── Relevance Pre-Filter ──────────────────────────────────────────

const SKIP_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|好的|谢谢|嗯|是的)\s*[.!?]*$/i,
  /^\/\w+$/, // bare slash command
  /^[\s\p{Emoji}\p{Emoji_Component}]*$/u, // pure emoji
]

function preFilter(content: string): string | null {
  const trimmed = content.trim()
  if (trimmed.length < MIN_PRE_FILTER_CONTENT_LENGTH) return null
  if (SKIP_PATTERNS.some((p) => p.test(trimmed))) return null
  if (trimmed.length > MAX_PRE_FILTER_CONTENT_LENGTH) {
    return trimmed.slice(0, MAX_PRE_FILTER_CONTENT_LENGTH) + '\n[...truncated]'
  }
  return trimmed
}

// ─── MemoryExtractor ───────────────────────────────────────────────

export class MemoryExtractor {
  private readonly deps: MemoryExtractorDeps

  constructor(deps: MemoryExtractorDeps) {
    this.deps = deps
  }

  /**
   * Extract candidate memories from an interaction event.
   *
   * @param event - Standardized interaction event
   * @param existingMemories - Currently active memories (for dedup in prompt)
   * @returns Array of candidate memories (may be empty)
   */
  async extract(
    event: InteractionEvent,
    existingMemories: { user: MemoryItem[]; project: MemoryItem[] },
  ): Promise<CandidateMemory[]> {
    // Pre-filter
    const filtered = preFilter(event.content)
    if (!filtered) {
      log.debug('Pre-filter rejected content', { source: event.type, len: event.content.length })
      return []
    }

    const promptParams: ExtractionPromptParams = {
      content: filtered,
      projectName: event.metadata.projectName ?? null,
      sourceType: event.type,
      existingMemories: {
        user: existingMemories.user.slice(0, MAX_EXISTING_MEMORIES_IN_PROMPT),
        project: existingMemories.project.slice(0, MAX_EXISTING_MEMORIES_IN_PROMPT),
      },
    }
    const prompt = buildExtractionPrompt(promptParams)

    // Fallback scope when LLM omits the scope field
    const defaultScope: MemoryScope = event.projectId ? 'project' : 'user'

    try {
      const t0 = Date.now()
      const responseText = await this.deps.llmClient.query({
        systemPrompt: 'You are a memory extraction assistant. Return ONLY valid JSON, no markdown fences or explanation.',
        userMessage: prompt,
        timeoutMs: EXTRACTION_TIMEOUT_MS,
      })
      const candidates = this.parseResponse(responseText, defaultScope)
      log.info('extract succeeded', {
        source: event.type,
        contentLength: filtered.length,
        responseLength: responseText.length,
        candidateCount: candidates.length,
        durationMs: Date.now() - t0,
      })
      return candidates
    } catch (err) {
      log.error('Extraction failed', err)
      return []
    }
  }

  /**
   * Parse the LLM JSON response into candidate memories.
   */
  private parseResponse(text: string, defaultScope: MemoryScope): CandidateMemory[] {
    // Strip markdown fences if present
    let cleaned = text.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    let parsed: { memories?: unknown[]; skipReason?: string }
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Attempt to repair truncated JSON (LLM response cut off by timeout)
      const repaired = this.repairTruncatedJson(cleaned)
      if (repaired) {
        try {
          parsed = JSON.parse(repaired)
        } catch {
          log.warn('Failed to parse extraction response as JSON (repair also failed)', { text: cleaned.slice(0, 200) })
          return []
        }
      } else {
        log.warn('Failed to parse extraction response as JSON', { text: cleaned.slice(0, 200) })
        return []
      }
    }

    if (parsed.skipReason) {
      log.debug('Extraction skipped by LLM', { reason: parsed.skipReason })
      return []
    }

    if (!Array.isArray(parsed.memories)) {
      log.debug('parseResponse: no memories array in LLM response', {
        keys: Object.keys(parsed).join(', '),
        preview: cleaned.slice(0, 300),
      })
      return []
    }

    let skippedEmpty = 0
    let skippedLowConfidence = 0
    const results: CandidateMemory[] = []
    for (const raw of parsed.memories) {
      if (typeof raw !== 'object' || raw === null) continue
      const m = raw as Record<string, unknown>

      const content = typeof m.content === 'string' ? m.content.trim() : ''
      if (!content) { skippedEmpty++; continue }
      // Trust the LLM: the prompt specifies the length constraint; if the LLM
      // still exceeds it, the extra content is deemed necessary. Store as-is.
      if (content.length > MEMORY_LIMITS.maxContentLength) {
        log.debug('oversized memory content accepted (LLM exceeded prompt constraint)', {
          length: content.length,
          limit: MEMORY_LIMITS.maxContentLength,
        })
      }

      const confidence = clampConfidence(typeof m.confidence === 'number' ? m.confidence : 0.7)
      if (confidence < MEMORY_LIMITS.minConfidence) { skippedLowConfidence++; continue }

      const rawCategory = typeof m.category === 'string' ? m.category : 'fact'
      const rawScope = typeof m.scope === 'string' ? m.scope : defaultScope

      const rawAction = typeof m.action === 'string' ? m.action : 'new'
      const targetId = typeof m.targetId === 'string' ? m.targetId : null
      const action: CandidateAction =
        rawAction === 'update' && targetId ? { type: 'update', targetId } : { type: 'new' }

      results.push({
        content,
        category: isValidMemoryCategory(rawCategory) ? rawCategory : 'fact',
        scope: isValidMemoryScope(rawScope) ? rawScope : defaultScope,
        confidence,
        tags: Array.isArray(m.tags) ? (m.tags.filter((t) => typeof t === 'string') as string[]).slice(0, MEMORY_LIMITS.maxTags) : [],
        reasoning: typeof m.reasoning === 'string' ? m.reasoning : '',
        action,
      })
    }

    if (results.length === 0 && parsed.memories.length > 0) {
      log.debug('parseResponse: all candidates filtered out', {
        rawCount: parsed.memories.length,
        skippedEmpty,
        skippedLowConfidence,
      })
    }

    return results
  }

  /**
   * Attempt to repair a truncated JSON response from the LLM.
   *
   * When the LLM hits maxTokens mid-generation, the JSON may be cut off.
   * Strategy: drop the last (incomplete) memory entry and close brackets.
   */
  private repairTruncatedJson(text: string): string | null {
    if (!text.startsWith('{')) return null

    const lastCompleteObject = text.lastIndexOf('},')
    if (lastCompleteObject === -1) return null

    const truncated = text.slice(0, lastCompleteObject + 1)
    const repaired = truncated + ']}'

    log.debug('Repaired truncated JSON', {
      originalLength: text.length,
      repairedLength: repaired.length,
    })

    return repaired
  }
}
