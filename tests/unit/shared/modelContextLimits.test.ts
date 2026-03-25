// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT_LIMIT_BY_ENGINE, getContextLimit } from '../../../src/shared/modelContextLimits'

describe('modelContextLimits', () => {
  it('matches known Claude model prefixes', () => {
    const limit = getContextLimit({ engineKind: 'claude', model: 'claude-sonnet-4-20250514' })
    expect(limit).toBe(200_000)
  })

  it('matches known Codex model prefixes', () => {
    const limit = getContextLimit({ engineKind: 'codex', model: 'gpt-5-codex' })
    expect(limit).toBe(200_000)
  })

  it('falls back to engine default when model is unknown', () => {
    const claudeFallback = getContextLimit({ engineKind: 'claude', model: 'mystery-model' })
    const codexFallback = getContextLimit({ engineKind: 'codex', model: 'mystery-model' })

    expect(claudeFallback).toBe(DEFAULT_CONTEXT_LIMIT_BY_ENGINE.claude)
    expect(codexFallback).toBe(DEFAULT_CONTEXT_LIMIT_BY_ENGINE.codex)
  })
})
