// SPDX-License-Identifier: Apache-2.0

import type { RuntimeResultPayload } from '../runtime/events'

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase()
}

function isModelIdMatch(params: { usageModel: string; sessionModel: string }): boolean {
  const usageModel = normalizeModelId(params.usageModel)
  const sessionModel = normalizeModelId(params.sessionModel)
  return (
    usageModel === sessionModel ||
    usageModel.startsWith(sessionModel) ||
    sessionModel.startsWith(usageModel) ||
    usageModel.includes(sessionModel) ||
    sessionModel.includes(usageModel)
  )
}

function toPositiveFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function resolveByMatchedCandidates(params: {
  candidates: Array<{ model: string; contextWindow: number }>
  sessionModel: string
}): number | null {
  const sessionModel = normalizeModelId(params.sessionModel)

  const exact = params.candidates.filter(
    (entry) => normalizeModelId(entry.model) === sessionModel,
  )
  if (exact.length > 0) {
    const unique = new Set(exact.map((entry) => entry.contextWindow))
    return unique.size === 1 ? exact[0].contextWindow : null
  }

  const fuzzy = params.candidates.filter((entry) =>
    isModelIdMatch({ usageModel: entry.model, sessionModel }),
  )
  if (fuzzy.length === 0) return null

  const unique = new Set(fuzzy.map((entry) => entry.contextWindow))
  return unique.size === 1 ? fuzzy[0].contextWindow : null
}

export function resolveContextLimitOverride(params: {
  modelUsage: RuntimeResultPayload['modelUsage']
  sessionModel: string | null
}): number | null {
  if (!params.modelUsage) return null

  const candidates = Object.entries(params.modelUsage)
    .map(([model, usage]) => ({
      model,
      contextWindow: toPositiveFiniteNumber(usage.contextWindow),
    }))
    .filter((entry): entry is { model: string; contextWindow: number } => entry.contextWindow != null)

  if (candidates.length === 0) return null

  if (params.sessionModel) {
    const matched = resolveByMatchedCandidates({
      candidates,
      sessionModel: params.sessionModel,
    })
    if (matched != null) return matched
  }

  const unique = new Set(candidates.map((entry) => entry.contextWindow))
  return unique.size === 1 ? candidates[0].contextWindow : null
}

