// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  clampConfidence,
  isValidMemoryScope,
  isValidMemoryCategory,
  isValidMemoryStatus,
  isValidMemorySource,
  validateCreateInput,
  MemoryValidationError,
} from '../../../electron/memory/validation'

describe('clampConfidence', () => {
  it('should return value in [0, 1] as-is', () => {
    expect(clampConfidence(0.5)).toBe(0.5)
    expect(clampConfidence(0)).toBe(0)
    expect(clampConfidence(1)).toBe(1)
  })

  it('should clamp values above 1', () => {
    expect(clampConfidence(1.5)).toBe(1)
    expect(clampConfidence(100)).toBe(1)
  })

  it('should clamp values below 0', () => {
    expect(clampConfidence(-0.5)).toBe(0)
    expect(clampConfidence(-100)).toBe(0)
  })

  it('should return fallback for NaN', () => {
    expect(clampConfidence(NaN)).toBe(0.7)
  })

  it('should return fallback for Infinity', () => {
    expect(clampConfidence(Infinity)).toBe(0.7)
    expect(clampConfidence(-Infinity)).toBe(0.7)
  })
})

describe('type guards', () => {
  it('isValidMemoryScope accepts valid scopes', () => {
    expect(isValidMemoryScope('user')).toBe(true)
    expect(isValidMemoryScope('project')).toBe(true)
  })

  it('isValidMemoryScope rejects invalid', () => {
    expect(isValidMemoryScope('invalid')).toBe(false)
    expect(isValidMemoryScope(null)).toBe(false)
    expect(isValidMemoryScope(42)).toBe(false)
  })

  it('isValidMemoryCategory accepts all valid categories', () => {
    const validCategories = [
      'preference', 'background', 'behavior', 'workflow',
      'fact', 'opinion', 'domain_knowledge', 'decision',
      'project_context', 'requirement', 'convention', 'lesson_learned',
    ]
    for (const c of validCategories) {
      expect(isValidMemoryCategory(c)).toBe(true)
    }
  })

  it('isValidMemoryCategory rejects invalid', () => {
    expect(isValidMemoryCategory('unknown')).toBe(false)
  })

  it('isValidMemoryStatus accepts valid statuses', () => {
    expect(isValidMemoryStatus('pending')).toBe(true)
    expect(isValidMemoryStatus('confirmed')).toBe(true)
    expect(isValidMemoryStatus('rejected')).toBe(true)
    expect(isValidMemoryStatus('archived')).toBe(true)
  })

  it('isValidMemorySource accepts valid sources', () => {
    expect(isValidMemorySource('session')).toBe(true)
    expect(isValidMemorySource('user_explicit')).toBe(true)
    expect(isValidMemorySource('ai_synthesis')).toBe(true)
  })
})

describe('validateCreateInput', () => {
  const validInput = {
    scope: 'user' as const,
    content: 'Valid content here',
    category: 'preference' as const,
    source: 'session' as const,
  }

  it('should pass for valid input', () => {
    expect(() => validateCreateInput(validInput)).not.toThrow()
  })

  it('should reject empty content', () => {
    expect(() => validateCreateInput({ ...validInput, content: '' })).toThrow(MemoryValidationError)
    expect(() => validateCreateInput({ ...validInput, content: '   ' })).toThrow(MemoryValidationError)
  })

  it('should reject content exceeding max length', () => {
    expect(() => validateCreateInput({ ...validInput, content: 'x'.repeat(1100) })).toThrow(MemoryValidationError)
  })

  it('should reject invalid scope', () => {
    expect(() => validateCreateInput({ ...validInput, scope: 'invalid' as 'user' })).toThrow(MemoryValidationError)
  })

  it('should reject invalid category', () => {
    expect(() => validateCreateInput({ ...validInput, category: 'nope' as 'fact' })).toThrow(MemoryValidationError)
  })

  it('should reject invalid source', () => {
    expect(() => validateCreateInput({ ...validInput, source: 'nope' as 'session' })).toThrow(MemoryValidationError)
  })

  it('should reject confidence out of range', () => {
    expect(() => validateCreateInput({ ...validInput, confidence: 1.5 })).toThrow(MemoryValidationError)
    expect(() => validateCreateInput({ ...validInput, confidence: -0.1 })).toThrow(MemoryValidationError)
  })

  it('should reject too many tags', () => {
    const tooManyTags = Array.from({ length: 15 }, (_, i) => `tag${i}`)
    expect(() => validateCreateInput({ ...validInput, tags: tooManyTags })).toThrow(MemoryValidationError)
  })
})
