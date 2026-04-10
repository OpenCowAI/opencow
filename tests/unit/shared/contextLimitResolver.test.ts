// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { resolveContextLimit } from '../../../src/shared/contextLimitResolver'
import {
  resetContextWindowCatalogForTest,
  setContextWindowCatalogForTest,
  type ContextWindowCatalog,
} from '../../../src/shared/contextWindowCatalog'

describe('resolveContextLimit', () => {
  afterEach(() => {
    resetContextWindowCatalogForTest()
  })

  it('prefers runtime authoritative limit over all fallbacks', () => {
    setContextWindowCatalogForTest({
      resolveContextWindow: () => ({
        limitTokens: 1_000_000,
        diagnostic: null,
      }),
    })

    const result = resolveContextLimit({
      engineKind: 'claude',
      model: 'claude-sonnet-4-6',
      contextState: {
        metricKind: 'context_occupancy',
        usedTokens: 10_000,
        limitTokens: 320_123,
        source: 'claude.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: 400_000,
    })

    expect(result).toEqual({
      limitTokens: 320_123,
      source: 'runtime_authoritative',
      diagnostic: null,
    })
  })

  it('uses turn.result override when runtime context is not authoritative', () => {
    setContextWindowCatalogForTest({
      resolveContextWindow: () => ({
        limitTokens: 1_000_000,
        diagnostic: null,
      }),
    })

    const result = resolveContextLimit({
      engineKind: 'claude',
      model: 'claude-sonnet-4-6',
      contextState: {
        metricKind: 'context_occupancy',
        usedTokens: 10_000,
        limitTokens: 200_000,
        source: 'turn.usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: 777_000,
    })

    expect(result).toEqual({
      limitTokens: 777_000,
      source: 'turn_result',
      diagnostic: null,
    })
  })

  it('falls back to catalog context_window when override is unavailable', () => {
    setContextWindowCatalogForTest({
      resolveContextWindow: () => ({
        limitTokens: 555_000,
        diagnostic: null,
      }),
    })

    const result = resolveContextLimit({
      engineKind: 'claude',
      model: 'claude-sonnet-4-6',
      contextState: null,
      contextLimitOverride: null,
    })

    expect(result).toEqual({
      limitTokens: 555_000,
      source: 'catalog',
      diagnostic: null,
    })
  })

  it('uses static fallback and returns diagnostic when catalog lookup fails', () => {
    const diagnostic = {
      code: 'catalog_lookup_failed' as const,
      message: 'synthetic failure',
      context: { model: 'mystery-model' },
    }

    setContextWindowCatalogForTest({
      resolveContextWindow: () => ({
        limitTokens: null,
        diagnostic,
      }),
    })

    const result = resolveContextLimit({
      engineKind: 'claude',
      model: 'mystery-model',
      contextState: null,
      contextLimitOverride: null,
    })

    expect(result.limitTokens).toBe(200_000)
    expect(result.source).toBe('static')
    expect(result.diagnostic).toEqual(diagnostic)
  })

  it('normalizes invalid dynamic limits and continues fallback chain', () => {
    const catalog: ContextWindowCatalog = {
      resolveContextWindow: () => ({
        limitTokens: null,
        diagnostic: null,
      }),
    }
    setContextWindowCatalogForTest(catalog)

    const result = resolveContextLimit({
      engineKind: 'claude',
      model: 'claude-opus-4',
      contextState: {
        metricKind: 'context_occupancy',
        usedTokens: 10_000,
        limitTokens: -1,
        source: 'claude.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: Number.NaN,
    })

    expect(result).toEqual({
      limitTokens: 200_000,
      source: 'static',
      diagnostic: null,
    })
  })
})
