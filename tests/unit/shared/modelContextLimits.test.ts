// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_LIMIT, getContextLimit } from '../../../src/shared/modelContextLimits'

describe('modelContextLimits', () => {
  it('matches known Claude model prefixes', () => {
    const limit = getContextLimit({ model: 'claude-sonnet-4-20250514' })
    expect(limit).toBe(200_000)
  })

  it('falls back to default when model is unknown', () => {
    expect(getContextLimit({ model: 'mystery-model' })).toBe(DEFAULT_CONTEXT_LIMIT)
  })
})
