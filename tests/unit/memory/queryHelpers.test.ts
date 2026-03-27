// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { extractCount, extractAvg } from '../../../electron/memory/queryHelpers'

describe('extractCount', () => {
  it('should extract count from valid row', () => {
    expect(extractCount({ cnt: 42 })).toBe(42)
  })

  it('should return 0 for undefined row', () => {
    expect(extractCount(undefined)).toBe(0)
  })

  it('should return 0 for null row', () => {
    expect(extractCount(null)).toBe(0)
  })

  it('should return 0 for non-object row', () => {
    expect(extractCount('string')).toBe(0)
    expect(extractCount(123)).toBe(0)
  })

  it('should return 0 for missing field', () => {
    expect(extractCount({ other: 5 })).toBe(0)
  })

  it('should return 0 for non-numeric value', () => {
    expect(extractCount({ cnt: 'not a number' })).toBe(0)
  })

  it('should return 0 for NaN', () => {
    expect(extractCount({ cnt: NaN })).toBe(0)
  })

  it('should return 0 for Infinity', () => {
    expect(extractCount({ cnt: Infinity })).toBe(0)
  })

  it('should support custom field name', () => {
    expect(extractCount({ total: 10 }, 'total')).toBe(10)
  })
})

describe('extractAvg', () => {
  it('should extract average from valid row', () => {
    expect(extractAvg({ avg_conf: 0.85 })).toBe(0.85)
  })

  it('should return 0 for undefined row', () => {
    expect(extractAvg(undefined)).toBe(0)
  })

  it('should return 0 for NaN value', () => {
    expect(extractAvg({ avg_conf: NaN })).toBe(0)
  })
})
