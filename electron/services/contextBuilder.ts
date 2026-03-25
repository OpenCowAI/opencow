// SPDX-License-Identifier: Apache-2.0

import type { ContextRef, ContextRefType } from '../../src/shared/types'
import { estimateTokens, truncateToTokenBudget } from '../utils/tokenCounter'

export interface ContextRefResolver {
  readonly type: ContextRefType
  resolve(id: string): Promise<string | null>
}

export interface BuildContextOpts {
  /** Total token budget for all context (default: 40_000) */
  tokenBudget?: number
  /** Per-ref token cap — prevents one ref monopolizing the budget (default: 10_000) */
  perRefTokenBudget?: number
}

export interface BuiltContext {
  /** Ready-to-inject XML block, or empty string if no context */
  systemPromptBlock: string
  resolvedCount: number
  skippedCount: number
  truncated: boolean
}

export class ContextBuilder {
  private readonly resolvers: Map<ContextRefType, ContextRefResolver>

  constructor(resolvers: ContextRefResolver[]) {
    this.resolvers = new Map(resolvers.map((r) => [r.type, r]))
  }

  async build(refs: ContextRef[], opts: BuildContextOpts = {}): Promise<BuiltContext> {
    const { tokenBudget = 40_000, perRefTokenBudget = 10_000 } = opts

    // Resolve all refs concurrently; failures are isolated via allSettled
    const results = await Promise.allSettled(
      refs.map(async (ref) => {
        const resolver = this.resolvers.get(ref.type)
        if (!resolver) return null
        return resolver.resolve(ref.id)
      }),
    )

    const sections: string[] = []
    let resolvedCount = 0
    let skippedCount = 0
    let totalTokens = 0
    let truncated = false

    for (const result of results) {
      if (result.status === 'rejected' || result.value === null) {
        skippedCount++
        continue
      }

      let section = result.value
      const sectionTokens = estimateTokens(section)

      // Skip this ref if adding it would exceed total budget
      if (totalTokens + sectionTokens > tokenBudget) {
        truncated = true
        skippedCount++
        continue
      }

      // Truncate this ref if it alone exceeds per-ref budget
      if (sectionTokens > perRefTokenBudget) {
        section = truncateToTokenBudget(section, perRefTokenBudget)
        truncated = true
      }

      sections.push(section)
      totalTokens += estimateTokens(section)
      resolvedCount++
    }

    const systemPromptBlock =
      sections.length > 0
        ? `<background_context>\n${sections.join('\n\n')}\n</background_context>`
        : ''

    return { systemPromptBlock, resolvedCount, skippedCount, truncated }
  }
}
