// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { GenaiPricesContextWindowCatalog } from '../../../src/shared/contextWindowCatalog'

describe('GenaiPricesContextWindowCatalog', () => {
  it('returns a known context_window from genai-prices for Claude', () => {
    const catalog = new GenaiPricesContextWindowCatalog()

    const result = catalog.resolveContextWindow({
      model: 'claude-sonnet-4-6',
    })

    expect(result.diagnostic).toBeNull()
    expect(result.limitTokens).toBe(1_000_000)
  })

  it('returns null without diagnostic when model is null', () => {
    const catalog = new GenaiPricesContextWindowCatalog()

    const result = catalog.resolveContextWindow({
      model: null,
    })

    expect(result).toEqual({
      limitTokens: null,
      diagnostic: null,
    })
  })

  it('returns null without diagnostic when model does not exist', () => {
    const catalog = new GenaiPricesContextWindowCatalog()

    const result = catalog.resolveContextWindow({
      model: 'non-existent-model-xyz',
    })

    expect(result).toEqual({
      limitTokens: null,
      diagnostic: null,
    })
  })
})
