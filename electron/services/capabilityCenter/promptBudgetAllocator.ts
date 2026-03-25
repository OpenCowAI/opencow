// SPDX-License-Identifier: Apache-2.0

export interface BudgetCandidate<T> {
  id: string
  priority: number
  order: number
  charCost: number
  payload: T
}

export interface BudgetAllocationResult<T> {
  selected: BudgetCandidate<T>[]
  dropped: BudgetCandidate<T>[]
  usedChars: number
  maxChars: number
}

/**
 * Deterministic prompt budget allocator.
 *
 * Selection priority: higher priority first, then lower order index, then id.
 * Return order: original order for selected and dropped.
 */
export function allocateWithinBudget<T>(
  candidates: BudgetCandidate<T>[],
  maxChars: number,
): BudgetAllocationResult<T> {
  const ranked = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    if (a.order !== b.order) return a.order - b.order
    return a.id.localeCompare(b.id)
  })

  let usedChars = 0
  const selectedIds = new Set<string>()

  for (const candidate of ranked) {
    if (usedChars + candidate.charCost > maxChars) continue
    usedChars += candidate.charCost
    selectedIds.add(candidate.id)
  }

  const selected = candidates.filter((candidate) => selectedIds.has(candidate.id))
  const dropped = candidates.filter((candidate) => !selectedIds.has(candidate.id))

  return {
    selected,
    dropped,
    usedChars,
    maxChars,
  }
}
