// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { ExplicitNoConfirmDetector } from '../../../electron/services/lifecycleOperations/explicitNoConfirmDetector'

describe('ExplicitNoConfirmDetector', () => {
  const detector = new ExplicitNoConfirmDetector()

  it('returns high-confidence explicit no-confirm for direct execute intent', () => {
    const result = detector.detect('不用确认，直接执行')
    expect(result.explicitNoConfirm).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.evidence).toBeTruthy()
  })

  it('returns low-confidence no for confirm-first intent', () => {
    const result = detector.detect('先确认一下草稿')
    expect(result.explicitNoConfirm).toBe(false)
    expect(result.confidence).toBe('low')
    expect(result.evidence).toBeTruthy()
  })

  it('returns low-confidence no for ambiguous text', () => {
    const result = detector.detect('请帮我处理这个')
    expect(result.explicitNoConfirm).toBe(false)
    expect(result.confidence).toBe('low')
    expect(result.evidence).toBeNull()
  })
})
