// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { resolveContextDisplayState } from '../../../src/shared/contextDisplay'
import type { ManagedSessionInfo } from '../../../src/shared/types'

function makeSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'session-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'streaming',
    stopReason: null,
    origin: { source: 'issue', issueId: 'issue-1' },
    projectId: null,
    projectPath: '/tmp/project',
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastInputTokens: 0,
    contextLimitOverride: null,
    contextState: null,
    contextTelemetry: null,
    activeDurationMs: 0,
    activeStartedAt: null,
    activity: null,
    error: null,
    executionContext: null,
    ...overrides,
  }
}

describe('resolveContextDisplayState', () => {
  // ── usedTokens resolution ──

  it('uses contextState.usedTokens when available', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 50_000,
        limitTokens: 200_000,
        source: 'turn.usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
      lastInputTokens: 10_000,
    }))
    expect(result.usedTokens).toBe(50_000)
  })

  it('falls back to lastInputTokens when contextState is null', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
      lastInputTokens: 30_000,
    }))
    expect(result.usedTokens).toBe(30_000)
  })

  it('returns 0 when both contextState and lastInputTokens are 0', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
      lastInputTokens: 0,
    }))
    expect(result.usedTokens).toBe(0)
  })

  it('does NOT fall back to aggregate inputTokens', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
      lastInputTokens: 0,
      inputTokens: 50_000,
    }))
    // Aggregate inputTokens is intentionally not used — it is a cumulative
    // sum across all turns and does not represent context window usage.
    expect(result.usedTokens).toBe(0)
  })

  // ── limitTokens resolution ──

  it('uses contextState.limitTokens when available', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 10_000,
        limitTokens: 1_000_000,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
    }))
    expect(result.limitTokens).toBe(1_000_000)
  })

  it('uses contextLimitOverride when contextState.limitTokens is null', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 10_000,
        limitTokens: null,
        source: 'turn.usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: 1_000_000,
      model: 'claude-sonnet-4-6',
    }))
    expect(result.limitTokens).toBe(1_000_000)
  })

  it('falls back to static model limit when both contextState.limitTokens and contextLimitOverride are null', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 10_000,
        limitTokens: null,
        source: 'turn.usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: null,
      model: 'claude-sonnet-4-6',
    }))
    // claude-sonnet-4 → 200,000 from modelContextLimits
    expect(result.limitTokens).toBe(200_000)
  })

  it('prefers contextState.limitTokens over contextLimitOverride', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 10_000,
        limitTokens: 500_000,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
      contextLimitOverride: 1_000_000,
    }))
    expect(result.limitTokens).toBe(500_000)
  })

  it('falls back to static model limit when contextState is null', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
      model: 'claude-opus-4',
    }))
    expect(result.limitTokens).toBe(200_000)
  })

  it('uses engine default when model is unknown', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
      model: 'unknown-model-xyz',
      engineKind: 'claude',
    }))
    expect(result.limitTokens).toBe(200_000) // engine default
  })

  // ── estimated flag ──

  it('returns estimated=false for authoritative contextState', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 5_000,
        limitTokens: 200_000,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
    }))
    expect(result.estimated).toBe(false)
  })

  it('returns estimated=true for estimated contextState', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: {
        usedTokens: 5_000,
        limitTokens: null,
        source: 'turn.usage',
        confidence: 'estimated',
        updatedAtMs: Date.now(),
      },
    }))
    expect(result.estimated).toBe(true)
  })

  it('returns estimated=true when contextState is null', () => {
    const result = resolveContextDisplayState(makeSession({
      contextState: null,
    }))
    expect(result.estimated).toBe(true)
  })

  // ── Integration: matches existing SessionStatusBar test expectations ──

  it('resolves lastInputTokens=50k against static limit to 75% remaining', () => {
    const result = resolveContextDisplayState(makeSession({
      lastInputTokens: 50_000,
      model: 'claude-sonnet-4-6',
    }))
    expect(result.usedTokens).toBe(50_000)
    expect(result.limitTokens).toBe(200_000)
    // 50k / 200k = 25% used → 75% remaining
    const remainingPct = Math.round((1 - result.usedTokens / result.limitTokens) * 100)
    expect(remainingPct).toBe(75)
  })

  it('prefers contextState over legacy fallback fields', () => {
    const result = resolveContextDisplayState(makeSession({
      engineKind: 'codex',
      model: 'gpt-5-codex',
      lastInputTokens: 10_000,
      contextLimitOverride: 120_000,
      contextState: {
        usedTokens: 50_000,
        limitTokens: 1_000_000,
        source: 'codex.token_count',
        confidence: 'authoritative',
        updatedAtMs: Date.now(),
      },
    }))
    expect(result.usedTokens).toBe(50_000)
    expect(result.limitTokens).toBe(1_000_000)
    expect(result.estimated).toBe(false)
  })
})
