// SPDX-License-Identifier: Apache-2.0

import type {
  MemoryScope,
  MemoryCategory,
  MemoryStatus,
  MemorySource,
  MemoryCreateInput,
} from '@shared/types'
import { MEMORY_LIMITS } from '@shared/types'

// ─── Custom Error ──────────────────────────────────────────────────

export class MemoryValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message)
    this.name = 'MemoryValidationError'
  }
}

// ─── Enum Sets ─────────────────────────────────────────────────────

const VALID_SCOPES = new Set<string>(['user', 'project'])

const VALID_CATEGORIES = new Set<string>([
  'preference', 'background', 'behavior', 'workflow',
  'fact', 'opinion', 'domain_knowledge', 'decision',
  'project_context', 'requirement', 'convention', 'lesson_learned',
])

const VALID_STATUSES = new Set<string>(['pending', 'confirmed', 'rejected', 'archived'])

const VALID_SOURCES = new Set<string>([
  'session', 'issue', 'issue_session', 'review_session',
  'schedule', 'capability', 'user_explicit', 'ai_synthesis',
])

const VALID_CONFIRMED_BY = new Set<string | null>([null, 'user', 'auto'])

// ─── Type Guards ───────────────────────────────────────────────────

export function isValidMemoryScope(v: unknown): v is MemoryScope {
  return typeof v === 'string' && VALID_SCOPES.has(v)
}

export function isValidMemoryCategory(v: unknown): v is MemoryCategory {
  return typeof v === 'string' && VALID_CATEGORIES.has(v)
}

export function isValidMemoryStatus(v: unknown): v is MemoryStatus {
  return typeof v === 'string' && VALID_STATUSES.has(v)
}

export function isValidMemorySource(v: unknown): v is MemorySource {
  return typeof v === 'string' && VALID_SOURCES.has(v)
}

export function isValidConfirmedBy(v: unknown): v is 'user' | 'auto' | null {
  return v === null || v === 'user' || v === 'auto'
}

// ─── Value Clamping ────────────────────────────────────────────────

/** Clamp a confidence score to the [0, 1] range. */
export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.7 // fallback for NaN/Infinity
  return Math.max(0, Math.min(1, n))
}

// ─── Input Validation ──────────────────────────────────────────────

/** Validate a MemoryCreateInput before DB insert. Throws MemoryValidationError. */
export function validateCreateInput(input: MemoryCreateInput): void {
  // Content
  if (!input.content || input.content.trim().length === 0) {
    throw new MemoryValidationError('Content must not be empty', 'content')
  }
  if (input.content.length > MEMORY_LIMITS.maxContentLength) {
    throw new MemoryValidationError(
      `Content exceeds max length (${input.content.length} > ${MEMORY_LIMITS.maxContentLength})`,
      'content',
    )
  }

  // Scope
  if (!isValidMemoryScope(input.scope)) {
    throw new MemoryValidationError(`Invalid scope: ${String(input.scope)}`, 'scope')
  }

  // Category
  if (!isValidMemoryCategory(input.category)) {
    throw new MemoryValidationError(`Invalid category: ${String(input.category)}`, 'category')
  }

  // Source
  if (!isValidMemorySource(input.source)) {
    throw new MemoryValidationError(`Invalid source: ${String(input.source)}`, 'source')
  }

  // Confidence
  if (input.confidence !== undefined) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new MemoryValidationError(
        `Confidence must be in [0, 1], got ${input.confidence}`,
        'confidence',
      )
    }
  }

  // Tags
  if (input.tags && input.tags.length > MEMORY_LIMITS.maxTags) {
    throw new MemoryValidationError(
      `Too many tags (${input.tags.length} > ${MEMORY_LIMITS.maxTags})`,
      'tags',
    )
  }
}
