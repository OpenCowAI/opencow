// SPDX-License-Identifier: Apache-2.0

import type { RuntimeContextSnapshotPayload } from '../runtime/events'

export interface NormalizedContextSnapshot {
  readonly metricKind: 'context_occupancy'
  readonly usedTokens: number
  readonly limitTokens: number | null
  readonly source: string
  readonly confidence: 'authoritative' | 'estimated'
  readonly updatedAtMs: number
}

function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.trunc(value)
}

function toNullablePositiveInt(value: number | null): number | null {
  if (value == null) return null
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.trunc(value))
}

export function normalizeContextSnapshot(input: {
  snapshot: RuntimeContextSnapshotPayload
  occurredAtMs: number
}): NormalizedContextSnapshot | null {
  const { snapshot, occurredAtMs } = input

  // Only occupancy can be displayed as context window usage.
  if (snapshot.metricKind !== 'context_occupancy') return null

  const usedTokens = toNonNegativeInt(snapshot.usedTokens)
  const limitTokens = toNullablePositiveInt(snapshot.limitTokens)
  const updatedAtMs = Number.isFinite(snapshot.updatedAtMs ?? NaN) && (snapshot.updatedAtMs ?? 0) > 0
    ? Math.trunc(snapshot.updatedAtMs as number)
    : Math.max(1, Math.trunc(occurredAtMs))

  if (limitTokens != null && usedTokens > limitTokens) {
    // Semantic guard: impossible occupancy snapshot — reject to prevent
    // poisoning UI/persistence with cumulative-accounting values.
    return null
  }

  return {
    metricKind: 'context_occupancy',
    usedTokens,
    limitTokens,
    source: snapshot.source,
    confidence: snapshot.confidence,
    updatedAtMs,
  }
}

