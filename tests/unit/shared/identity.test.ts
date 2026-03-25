// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { generateId } from '../../../electron/shared/identity'

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId()
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
  })

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('returns URL-safe characters only (safe for SQLite PK and URL routing)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId()
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
