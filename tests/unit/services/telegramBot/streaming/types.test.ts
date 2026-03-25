// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { safeContent, TELEGRAM_SAFE_TEXT_LIMIT } from '../../../../../electron/services/telegramBot/streaming/types'

describe('safeContent', () => {
  it('returns short content as-is', () => {
    expect(safeContent('Hello')).toBe('Hello')
  })

  it('returns content exactly at the limit as-is', () => {
    const exact = 'A'.repeat(TELEGRAM_SAFE_TEXT_LIMIT)
    expect(safeContent(exact)).toBe(exact)
  })

  it('truncates content exceeding the limit and adds ellipsis', () => {
    const long = 'B'.repeat(TELEGRAM_SAFE_TEXT_LIMIT + 100)
    const result = safeContent(long)

    expect(result.length).toBe(TELEGRAM_SAFE_TEXT_LIMIT)
    expect(result.endsWith('…')).toBe(true)
    expect(result.startsWith('BBB')).toBe(true)
  })

  it('TELEGRAM_SAFE_TEXT_LIMIT is 4000', () => {
    expect(TELEGRAM_SAFE_TEXT_LIMIT).toBe(4000)
  })
})
