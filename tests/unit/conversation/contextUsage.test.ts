// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { resolveContextLimitOverride } from '../../../electron/conversation/projection/contextUsage'

describe('contextUsage', () => {
  // NOTE: computeContextSize was removed — engine-specific context size computation
  // now lives in the runtime adapters (claudeRuntimeAdapter, codexRuntimeAdapter).

  describe('resolveContextLimitOverride', () => {
    it('returns null when modelUsage is absent', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: undefined,
        sessionModel: 'claude-sonnet-4-6',
      })

      expect(resolved).toBeNull()
    })

    it('matches by exact session model when available', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: {
          'claude-sonnet-4-6': {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 1_000_000,
          },
          'claude-opus-4-6': {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 200_000,
          },
        },
        sessionModel: 'claude-sonnet-4-6',
      })

      expect(resolved).toBe(1_000_000)
    })

    it('matches by fuzzy model id when exact id differs by suffix', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: {
          'claude-sonnet-4': {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 1_000_000,
          },
        },
        sessionModel: 'claude-sonnet-4-6-20260101',
      })

      expect(resolved).toBe(1_000_000)
    })

    it('returns null when matched candidates disagree on context window', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: {
          'claude-sonnet-4': {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 1_000_000,
          },
          'claude-sonnet': {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 200_000,
          },
        },
        sessionModel: 'claude-sonnet-4-6',
      })

      expect(resolved).toBeNull()
    })

    it('falls back when all candidates share one context window', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: {
          alpha: {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 500_000,
          },
          beta: {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: 500_000,
          },
        },
        sessionModel: null,
      })

      expect(resolved).toBe(500_000)
    })

    it('ignores invalid context windows', () => {
      const resolved = resolveContextLimitOverride({
        modelUsage: {
          claude: {
            inputTokens: 10,
            outputTokens: 2,
            contextWindow: Number.NaN,
          },
          codex: {
            inputTokens: 10,
            outputTokens: 2,
          },
        },
        sessionModel: 'claude',
      })

      expect(resolved).toBeNull()
    })
  })
})
