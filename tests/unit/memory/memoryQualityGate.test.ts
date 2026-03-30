// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { MemoryQualityGate } from '../../../electron/memory/memoryQualityGate'
import type { CandidateMemory } from '../../../electron/memory/types'
import type { MemoryItem } from '@shared/types'

function makeCandidate(overrides: Partial<CandidateMemory> = {}): CandidateMemory {
  return {
    content: 'User prefers TypeScript strict mode',
    category: 'preference',
    scope: 'user',
    confidence: 0.9,
    tags: ['typescript'],
    reasoning: 'Explicitly stated',
    action: { type: 'new' },
    ...overrides,
  }
}

function makeMemoryItem(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: 'mem-1',
    scope: 'user',
    projectId: null,
    content: 'Existing memory content',
    category: 'preference',
    tags: [],
    confidence: 0.8,
    source: 'session',
    sourceId: null,
    reasoning: null,
    status: 'confirmed',
    confirmedBy: 'user',
    version: 1,
    previousId: null,
    accessCount: 0,
    lastAccessedAt: null,
    expiresAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// Minimal mock IMemoryStorage
function createMockStore() {
  return {
    search: vi.fn().mockResolvedValue([]),
  } as unknown as import('../../../electron/memory/storage/types').IMemoryStorage
}

describe('MemoryQualityGate', () => {
  it('should pass new candidates with sufficient confidence', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [makeCandidate({ confidence: 0.8 })]
    const result = await gate.evaluate(candidates, [])

    expect(result.newCandidates).toHaveLength(1)
    expect(result.newCandidates[0].content).toBe('User prefers TypeScript strict mode')
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should reject candidates with low confidence', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [makeCandidate({ confidence: 0.3 })]
    const result = await gate.evaluate(candidates, [])

    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should reject exact duplicate content', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const existing = [makeMemoryItem({ content: 'User prefers TypeScript strict mode' })]
    const candidates = [makeCandidate({ content: 'User prefers TypeScript strict mode' })]

    const result = await gate.evaluate(candidates, existing)
    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should reject case-insensitive duplicates', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const existing = [makeMemoryItem({ content: 'user prefers typescript strict mode' })]
    const candidates = [makeCandidate({ content: 'User Prefers TypeScript Strict Mode' })]

    const result = await gate.evaluate(candidates, existing)
    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should reject content that is too long', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [makeCandidate({ content: 'a'.repeat(1100) })]
    const result = await gate.evaluate(candidates, [])

    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should allow different candidates through', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [
      makeCandidate({ content: 'Prefers TypeScript' }),
      makeCandidate({ content: 'Works at Company X' }),
    ]
    const result = await gate.evaluate(candidates, [])

    expect(result.newCandidates).toHaveLength(2)
  })

  it('should prevent intra-batch duplicates', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [
      makeCandidate({ content: 'Same content here' }),
      makeCandidate({ content: 'Same content here' }),
    ]
    const result = await gate.evaluate(candidates, [])

    expect(result.newCandidates).toHaveLength(1)
  })

  it('should return empty result for empty input', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const result = await gate.evaluate([], [])
    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should allow two different candidates through', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [
      makeCandidate({ content: 'Meaningful content here' }),
      makeCandidate({ content: 'Different meaningful content' }),
    ]

    const result = await gate.evaluate(candidates, [])
    expect(result.newCandidates).toHaveLength(2)
  })

  // ── Merge-specific tests ──

  it('should route UPDATE candidate to mergeCandidates when target exists', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const existing = [makeMemoryItem({ id: 'mem-1', content: 'User likes minimal design' })]
    const candidates = [
      makeCandidate({
        content: 'User likes minimal design with Linear style and Jobs aesthetic',
        action: { type: 'update', targetId: 'mem-1' },
      }),
    ]

    const result = await gate.evaluate(candidates, existing)
    expect(result.newCandidates).toHaveLength(0)
    expect(result.mergeCandidates).toHaveLength(1)
    expect(result.mergeCandidates[0].target.id).toBe('mem-1')
    expect(result.mergeCandidates[0].candidate.content).toContain('Linear style')
  })

  it('should fall back to new when UPDATE target ID is hallucinated', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const candidates = [
      makeCandidate({
        content: 'Something new',
        action: { type: 'update', targetId: 'nonexistent-id' },
      }),
    ]

    const result = await gate.evaluate(candidates, [])
    expect(result.newCandidates).toHaveLength(1)
    expect(result.mergeCandidates).toHaveLength(0)
  })

  it('should auto-merge when Jaccard >= 0.7 and candidate is richer', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    // Existing: shorter version
    const existing = [makeMemoryItem({
      id: 'mem-1',
      content: 'user prefers minimal design style aesthetic',
      confidence: 0.7,
    })]
    // Mock FTS to return the existing memory
    ;(store.search as ReturnType<typeof vi.fn>).mockResolvedValue([existing[0]])

    // Candidate: same core words plus extra detail — Jaccard will be high
    // tokens existing: {user, prefers, minimal, design, style, aesthetic} = 6
    // tokens candidate: {user, prefers, minimal, design, style, aesthetic, with, linear, influence} = 9
    // intersection: 6, union: 9, Jaccard: 6/9 = 0.67 — still below 0.7
    // Need higher overlap:
    // existing: "user prefers minimal design" (4 tokens)
    // candidate: "user prefers minimal design Linear style" (6 tokens)
    // intersection: 4, union: 6, Jaccard: 4/6 = 0.67 — still not enough
    // Let's use content where overlap is >= 0.7:
    const candidates = [
      makeCandidate({
        // 8 tokens, 6 overlap with existing (6 tokens) → 6/8 = 0.75 > 0.7
        content: 'user prefers minimal design style aesthetic plus Linear',
        confidence: 0.9,
      }),
    ]

    const result = await gate.evaluate(candidates, existing)
    // Should be routed to merge (safety net), not new
    expect(result.mergeCandidates).toHaveLength(1)
    expect(result.newCandidates).toHaveLength(0)
  })

  it('should reject when Jaccard >= 0.7 and candidate is NOT richer', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    // Existing: longer with more detail and higher confidence
    const existing = [makeMemoryItem({
      id: 'mem-1',
      content: 'user prefers minimal design style aesthetic with Linear influences',
      confidence: 0.95,
    })]
    ;(store.search as ReturnType<typeof vi.fn>).mockResolvedValue([existing[0]])

    // Candidate: subset of existing, lower confidence
    // existing tokens: {user, prefers, minimal, design, style, aesthetic, with, linear, influences} = 9
    // candidate tokens: {user, prefers, minimal, design, style, aesthetic} = 6
    // intersection: 6, union: 9, Jaccard: 6/9 = 0.67 — need higher
    // Use more overlap:
    const candidates = [
      makeCandidate({
        // 7 tokens, all in existing (9 tokens) → 7/9 = 0.78 > 0.7
        content: 'user prefers minimal design style aesthetic with',
        confidence: 0.7,
      }),
    ]

    const result = await gate.evaluate(candidates, existing)
    expect(result.mergeCandidates).toHaveLength(0)
    expect(result.newCandidates).toHaveLength(0) // rejected as too_similar
  })

  it('should keep only highest-confidence candidate when two target the same memory', async () => {
    const store = createMockStore()
    const gate = new MemoryQualityGate(store)

    const existing = [makeMemoryItem({ id: 'mem-1', content: 'User likes design' })]
    const candidates = [
      makeCandidate({
        content: 'User likes minimal design v1',
        confidence: 0.7,
        action: { type: 'update', targetId: 'mem-1' },
      }),
      makeCandidate({
        content: 'User likes minimal design v2 with more detail',
        confidence: 0.95,
        action: { type: 'update', targetId: 'mem-1' },
      }),
    ]

    const result = await gate.evaluate(candidates, existing)
    expect(result.mergeCandidates).toHaveLength(1)
    expect(result.mergeCandidates[0].candidate.confidence).toBe(0.95)
  })
})
