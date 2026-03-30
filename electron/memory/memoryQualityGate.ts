// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto'
import { createLogger } from '../platform/logger'
import type { IMemoryStorage } from './storage/types'
import type { CandidateMemory } from './types'
import type { MemoryItem } from '@shared/types'
import { MEMORY_LIMITS } from '@shared/types'
import { CONTENT_HASH_LENGTH, JACCARD_DUPLICATE_THRESHOLD, JACCARD_MERGE_THRESHOLD } from './constants'

const log = createLogger('MemoryQualityGate')

// ─── Rejection Reasons ─────────────────────────────────────────────

export type RejectionReason =
  | 'low_confidence'
  | 'content_too_long'
  | 'exact_duplicate'
  | 'too_similar'

// ─── Quality Gate Result ────────────────────────────────────────────

export interface QualityGateResult {
  newCandidates: CandidateMemory[]
  mergeCandidates: Array<{ candidate: CandidateMemory; target: MemoryItem }>
}

// ─── Internal Evaluation Result ─────────────────────────────────────

type CandidateOutcome =
  | { outcome: 'accept' }
  | { outcome: 'reject'; reason: RejectionReason }
  | { outcome: 'merge'; target: MemoryItem }
  | { outcome: 'fallthrough' }

// ─── Content Hashing ───────────────────────────────────────────────

function contentHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ')
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, CONTENT_HASH_LENGTH)
}

// ─── MemoryQualityGate ─────────────────────────────────────────────

/**
 * Filters, deduplicates, and routes candidate memories.
 *
 * Pipeline per candidate:
 *   1. Confidence filter
 *   2. Content length check
 *   3. Route by action type:
 *      - action="update" → validate target exists → merge
 *      - action="new"    → hash dedup → Jaccard check → accept or auto-merge
 *
 * All operations are local (no LLM calls).
 */
export class MemoryQualityGate {
  constructor(private readonly store: IMemoryStorage) {}

  /**
   * Evaluate candidates against existing memories.
   * Returns new candidates and merge candidates separately.
   */
  async evaluate(
    candidates: CandidateMemory[],
    existingMemories: MemoryItem[],
  ): Promise<QualityGateResult> {
    if (candidates.length === 0) return { newCandidates: [], mergeCandidates: [] }

    const existingHashes = new Set(existingMemories.map((m) => contentHash(m.content)))
    const existingById = new Map(existingMemories.map((m) => [m.id, m]))
    const rejectionCounts = new Map<RejectionReason, number>()

    const newCandidates: CandidateMemory[] = []
    const mergeCandidates: Array<{ candidate: CandidateMemory; target: MemoryItem }> = []

    // Track merge targets to prevent multiple candidates targeting the same memory
    const mergeTargetIds = new Map<string, CandidateMemory>()

    for (const candidate of candidates) {
      // 1. Universal checks: confidence and content length
      if (candidate.confidence < MEMORY_LIMITS.minConfidence) {
        this.countRejection(rejectionCounts, 'low_confidence')
        continue
      }
      if (candidate.content.length > MEMORY_LIMITS.maxContentLength) {
        this.countRejection(rejectionCounts, 'content_too_long')
        continue
      }

      // 2. Route by action type
      let outcome: CandidateOutcome

      if (candidate.action.type === 'update') {
        outcome = this.evaluateUpdateCandidate(candidate, existingById, mergeTargetIds)
        if (outcome.outcome === 'fallthrough') {
          // Target not found or lower confidence — try as new candidate
          outcome = await this.evaluateNewCandidate(candidate, existingHashes, mergeTargetIds)
        }
      } else {
        outcome = await this.evaluateNewCandidate(candidate, existingHashes, mergeTargetIds)
      }

      // 3. Route result to appropriate collection
      const preview = candidate.content.length > 60 ? candidate.content.slice(0, 60) + '…' : candidate.content
      switch (outcome.outcome) {
        case 'accept':
          log.debug('candidate routed → accept', { preview, scope: candidate.scope })
          newCandidates.push(candidate)
          break
        case 'merge':
          log.debug('candidate routed → merge', { preview, targetId: outcome.target.id })
          this.addMergeCandidate(candidate, outcome.target, mergeTargetIds, mergeCandidates)
          break
        case 'reject':
          log.debug('candidate routed → reject', { preview, reason: outcome.reason })
          this.countRejection(rejectionCounts, outcome.reason)
          break
      }
    }

    log.debug('Quality gate result', {
      input: candidates.length,
      new: newCandidates.length,
      merge: mergeCandidates.length,
      rejections: Object.fromEntries(rejectionCounts),
    })

    return { newCandidates, mergeCandidates }
  }

  // ── Update Candidate (LLM explicitly said "update") ─────────────

  private evaluateUpdateCandidate(
    candidate: CandidateMemory,
    existingById: Map<string, MemoryItem>,
    mergeTargetIds: Map<string, CandidateMemory>,
  ): CandidateOutcome {
    if (candidate.action.type !== 'update') return { outcome: 'fallthrough' }

    const target = existingById.get(candidate.action.targetId)
    if (!target || target.status !== 'confirmed') {
      // LLM hallucinated an ID — fall through to new-candidate pipeline
      return { outcome: 'fallthrough' }
    }

    // Deduplicate: if another candidate already targets the same memory, keep higher confidence
    const existingMerge = mergeTargetIds.get(target.id)
    if (existingMerge && existingMerge.confidence >= candidate.confidence) {
      return { outcome: 'fallthrough' }
    }

    return { outcome: 'merge', target }
  }

  // ── New Candidate (standard dedup + auto-merge safety net) ──────

  private async evaluateNewCandidate(
    candidate: CandidateMemory,
    existingHashes: Set<string>,
    mergeTargetIds: Map<string, CandidateMemory>,
  ): Promise<CandidateOutcome> {
    // 1. Exact hash dedup
    const hash = contentHash(candidate.content)
    if (existingHashes.has(hash)) {
      return { outcome: 'reject', reason: 'exact_duplicate' }
    }

    // 2. FTS keyword similarity check — with auto-merge safety net
    try {
      const keywords = candidate.content.split(/\s+/).slice(0, 5).join(' ')
      // Search across ALL scopes — cross-scope dedup prevents user-level knowledge
      // from being duplicated as project-level (and vice versa)
      const similar = await this.store.search({
        query: keywords,
        status: 'confirmed',
        limit: 5,
      })

      for (const existing of similar) {
        const similarity = this.jaccard(candidate.content, existing.content)

        if (similarity >= JACCARD_DUPLICATE_THRESHOLD) {
          // High similarity: merge if candidate is richer AND scope is compatible
          if (this.isRicherThan(candidate, existing) && this.isScopeCompatibleForMerge(candidate, existing) && !mergeTargetIds.has(existing.id)) {
            return { outcome: 'merge', target: existing }
          }
          return { outcome: 'reject', reason: 'too_similar' }
        }

        if (similarity >= JACCARD_MERGE_THRESHOLD && this.isRicherThan(candidate, existing) && this.isScopeCompatibleForMerge(candidate, existing) && !mergeTargetIds.has(existing.id)) {
          return { outcome: 'merge', target: existing }
        }
      }
    } catch (err) {
      // FTS search failure is non-fatal — allow the candidate through
      log.warn('FTS similarity search failed, allowing candidate through', err)
    }

    // Add hash to prevent intra-batch duplicates
    existingHashes.add(hash)

    return { outcome: 'accept' }
  }

  // ── Merge Collection Management ─────────────────────────────────

  /** Add a merge candidate, replacing any lower-confidence candidate targeting the same memory. */
  private addMergeCandidate(
    candidate: CandidateMemory,
    target: MemoryItem,
    mergeTargetIds: Map<string, CandidateMemory>,
    mergeCandidates: Array<{ candidate: CandidateMemory; target: MemoryItem }>,
  ): void {
    // Replace existing lower-confidence merge for this target
    const existingMerge = mergeTargetIds.get(target.id)
    if (existingMerge) {
      const idx = mergeCandidates.findIndex((mc) => mc.target.id === target.id)
      if (idx !== -1) mergeCandidates.splice(idx, 1)
    }

    mergeTargetIds.set(target.id, candidate)
    mergeCandidates.push({ candidate, target })
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Whether the candidate carries more information than the existing memory. */
  private isRicherThan(candidate: CandidateMemory, existing: MemoryItem): boolean {
    return candidate.content.length > existing.content.length || candidate.confidence > existing.confidence
  }

  /**
   * Whether merging the candidate into the existing memory is scope-compatible.
   *
   * Prevents scope degradation: a project-scoped candidate should NOT be merged
   * into a user-level target (the user-level memory is already more general).
   *
   * When candidate is user-level and target is project-level, we allow the merge
   * to enrich the project memory's content. A future enhancement could also
   * update the target's scope to "user" for true scope promotion.
   */
  private isScopeCompatibleForMerge(candidate: CandidateMemory, existing: MemoryItem): boolean {
    if (candidate.scope === existing.scope) return true
    if (candidate.scope === 'project' && existing.scope === 'user') return false
    return true
  }

  /**
   * Jaccard similarity between two texts (token-level).
   * Returns 0.0 (no overlap) to 1.0 (identical).
   */
  private jaccard(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 0))
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 0))

    let intersection = 0
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++
    }

    const union = tokensA.size + tokensB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  private countRejection(counts: Map<RejectionReason, number>, reason: RejectionReason): void {
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
}
