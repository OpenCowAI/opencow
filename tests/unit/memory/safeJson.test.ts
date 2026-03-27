// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { safeJsonParse, safeJsonParseOrNull } from '../../../electron/shared/safeJson'

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    expect(safeJsonParse('{"key": "value"}', {})).toEqual({ key: 'value' })
    expect(safeJsonParse('[1, 2, 3]', [])).toEqual([1, 2, 3])
    expect(safeJsonParse('"hello"', '')).toBe('hello')
  })

  it('should return fallback for invalid JSON', () => {
    expect(safeJsonParse('not json', 'fallback')).toBe('fallback')
    expect(safeJsonParse('{broken', [])).toEqual([])
    expect(safeJsonParse('', 42)).toBe(42)
  })

  it('should return fallback for empty string', () => {
    expect(safeJsonParse('', [])).toEqual([])
  })
})

describe('safeJsonParseOrNull', () => {
  it('should parse valid JSON', () => {
    expect(safeJsonParseOrNull('{"a": 1}')).toEqual({ a: 1 })
  })

  it('should return null for invalid JSON', () => {
    expect(safeJsonParseOrNull('not json')).toBeNull()
    expect(safeJsonParseOrNull('')).toBeNull()
  })
})
