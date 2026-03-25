// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { normalizeFileContentReadResult } from '../../../src/renderer/lib/fileContentReadResult'

describe('normalizeFileContentReadResult', () => {
  it('keeps current result shape unchanged', () => {
    const result = normalizeFileContentReadResult({
      ok: true,
      data: {
        content: 'hello',
        language: 'markdown',
        size: 5,
      },
    })

    expect(result).toEqual({
      ok: true,
      data: {
        content: 'hello',
        language: 'markdown',
        size: 5,
      },
    })
  })

  it('adapts legacy payload shape into current success shape', () => {
    const result = normalizeFileContentReadResult({
      content: 'legacy-body',
      language: 'plaintext',
      size: 11,
    })

    expect(result).toEqual({
      ok: true,
      data: {
        content: 'legacy-body',
        language: 'plaintext',
        size: 11,
      },
    })
  })

  it('returns typed failure for invalid payload', () => {
    const result = normalizeFileContentReadResult({ value: 1 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('internal_error')
    expect(result.error.message).toBe('Invalid read-file-content IPC response')
  })
})
