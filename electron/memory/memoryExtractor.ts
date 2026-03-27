// SPDX-License-Identifier: Apache-2.0

/**
 * MemoryExtractor — uses the Claude Agent SDK to extract structured
 * memories from interaction events.
 *
 * Uses a headless SDK query (no tools, single turn) to analyse
 * interaction content and return candidate memories as JSON.
 */

import { existsSync } from 'node:fs'
import type { Query, SDKMessage, Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk'
import { MessageQueue } from '../command/messageQueue'
import { createLogger } from '../platform/logger'
import { buildExtractionPrompt } from './prompts/extractionPrompt'
import type { InteractionEvent, CandidateMemory, CandidateAction } from './types'
import type { MemoryItem, MemoryScope } from '@shared/types'
import { MEMORY_LIMITS } from '@shared/types'
import { clampConfidence, isValidMemoryCategory, isValidMemoryScope } from './validation'
import { MAX_EXISTING_MEMORIES_IN_PROMPT, EXTRACTION_TIMEOUT_MS, MIN_PRE_FILTER_CONTENT_LENGTH, MAX_PRE_FILTER_CONTENT_LENGTH } from './constants'

const log = createLogger('MemoryExtractor')

// ─── CLI Path Resolution ───────────────────────────────────────────

function resolveCliPath(): string | undefined {
  try {
    const cliPath = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    if (cliPath.includes('app.asar')) {
      const unpacked = cliPath.replace('app.asar', 'app.asar.unpacked')
      if (existsSync(unpacked)) return unpacked
    }
    return cliPath
  } catch {
    return undefined
  }
}

// ─── Dependencies ──────────────────────────────────────────────────

export interface MemoryExtractorDeps {
  getProviderEnv: () => Promise<Record<string, string>>
  getProxyEnv: () => Record<string, string>
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
    existingMemories: MemoryItem[],
  ): Promise<CandidateMemory[]> {
    // Pre-filter
    const filtered = preFilter(event.content)
    if (!filtered) {
      log.debug('Pre-filter rejected content', { source: event.type, len: event.content.length })
      return []
    }

    const scope: MemoryScope = event.projectId ? 'project' : 'user'
    const prompt = buildExtractionPrompt({
      content: filtered,
      scope,
      projectName: event.metadata.projectName,
      sourceType: event.type,
      existingMemories: existingMemories.slice(0, MAX_EXISTING_MEMORIES_IN_PROMPT),
    })

    try {
      const responseText = await this.runQuery(prompt)
      return this.parseResponse(responseText, scope)
    } catch (err) {
      log.error('Extraction failed', err)
      return []
    }
  }

  /**
   * Run a headless SDK query to get the extraction response.
   */
  private async runQuery(userMessage: string): Promise<string> {
    let providerEnv: Record<string, string>
    try {
      providerEnv = await this.deps.getProviderEnv()
    } catch (err) {
      throw new Error(`Failed to resolve provider environment: ${err instanceof Error ? err.message : String(err)}`)
    }
    const proxyEnv = this.deps.getProxyEnv()

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...proxyEnv,
      ...providerEnv,
    }

    const cliPath = resolveCliPath()

    const queue = new MessageQueue()
    queue.push(userMessage)

    const options: SdkOptions = {
      systemPrompt:
        'You are a memory extraction assistant. Return ONLY valid JSON, no markdown fences or explanation.',
      maxTurns: 1,
      env,
      tools: [],
      disallowedTools: [],
      allowDangerouslySkipPermissions: true,
      permissionMode: 'acceptEdits',
      ...(cliPath ? { pathToClaudeCodeExecutable: cliPath } : {}),
    }

    // Lazy import — avoid loading the heavy SDK module at app startup
    const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk')
    const sdkStream: Query = sdkQuery({ prompt: queue, options })

    // Set up timeout
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      sdkStream.close()
    }, EXTRACTION_TIMEOUT_MS)

    let result = ''

    try {
      for await (const message of sdkStream) {
        const raw = message as Record<string, unknown>
        const type = typeof raw.type === 'string' ? raw.type : ''
        const subtype = typeof raw.subtype === 'string' ? raw.subtype : null

        // Complete assistant message (type='assistant', subtype=null)
        // Contains the full response — replaces any partial accumulation.
        // SDK structure: { type: 'assistant', message: { content: ContentBlock[] } }
        if (type === 'assistant' && subtype === null) {
          const messageObj = raw.message as { content?: Array<Record<string, unknown>> } | undefined
          const blocks = messageObj?.content ?? []
          // Final message contains complete text — reset to avoid duplication with partials
          result = ''
          for (const block of blocks) {
            if (block.type === 'text' && typeof block.text === 'string') {
              result += block.text
            }
          }
        }
      }
    } catch (err) {
      if (timedOut) {
        throw new Error('Memory extraction timed out')
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
      queue.close()
    }

    return result
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
      log.debug('Extraction skipped', { reason: parsed.skipReason })
      return []
    }

    if (!Array.isArray(parsed.memories)) {
      return []
    }

    const results: CandidateMemory[] = []
    for (const raw of parsed.memories) {
      if (typeof raw !== 'object' || raw === null) continue
      const m = raw as Record<string, unknown>

      const content = typeof m.content === 'string' ? m.content.trim() : ''
      if (!content || content.length > MEMORY_LIMITS.maxContentLength) continue

      const confidence = clampConfidence(typeof m.confidence === 'number' ? m.confidence : 0.7)
      if (confidence < MEMORY_LIMITS.minConfidence) continue

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

    return results
  }

  /**
   * Attempt to repair a truncated JSON response from the LLM.
   *
   * When the LLM times out mid-generation, the JSON is often cut off inside
   * the memories array. Strategy: drop the last (incomplete) memory entry
   * and close the array/object brackets.
   *
   * Returns the repaired string, or null if repair is not feasible.
   */
  private repairTruncatedJson(text: string): string | null {
    // Must start with a JSON object
    if (!text.startsWith('{')) return null

    // Find the last complete memory object by locating the last `}, {` or `}]`
    const lastCompleteObject = text.lastIndexOf('},')
    if (lastCompleteObject === -1) {
      // No complete memory object found — can't salvage
      return null
    }

    // Truncate after the last complete object and close the structure
    const truncated = text.slice(0, lastCompleteObject + 1)
    const repaired = truncated + ']}'

    log.debug('Repaired truncated JSON', {
      originalLength: text.length,
      repairedLength: repaired.length,
    })

    return repaired
  }
}
