// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { allocateWithinBudget, type BudgetCandidate } from '../../../electron/services/capabilityCenter/promptBudgetAllocator'

describe('promptBudgetAllocator', () => {
  it('selects by priority and keeps original order in output', () => {
    const candidates: Array<BudgetCandidate<string>> = [
      { id: 'catalog-A', order: 0, priority: 10, charCost: 8, payload: 'A' },
      { id: 'full-B', order: 1, priority: 80, charCost: 8, payload: 'B' },
      { id: 'catalog-C', order: 2, priority: 10, charCost: 8, payload: 'C' },
    ]

    const result = allocateWithinBudget(candidates, 16)

    expect(result.selected.map((item) => item.id)).toEqual(['catalog-A', 'full-B'])
    expect(result.dropped.map((item) => item.id)).toEqual(['catalog-C'])
    expect(result.usedChars).toBe(16)
  })

  it('is deterministic for equal priorities using order then id', () => {
    const candidates: Array<BudgetCandidate<string>> = [
      { id: 'z', order: 1, priority: 10, charCost: 5, payload: 'z' },
      { id: 'a', order: 0, priority: 10, charCost: 5, payload: 'a' },
      { id: 'm', order: 2, priority: 10, charCost: 5, payload: 'm' },
    ]

    const result = allocateWithinBudget(candidates, 10)
    expect(result.selected.map((item) => item.id)).toEqual(['z', 'a'])
  })
})
