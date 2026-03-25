// SPDX-License-Identifier: Apache-2.0

import type { FileContentReadResult, FileContentResult } from '@shared/types'

type LegacyFileContentResult = FileContentResult

function asLegacyFileContentResult(value: unknown): LegacyFileContentResult | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<LegacyFileContentResult>
  if (typeof candidate.content !== 'string') return null
  if (typeof candidate.language !== 'string') return null
  const size =
    typeof candidate.size === 'number'
      ? candidate.size
      : new TextEncoder().encode(candidate.content).length
  return {
    content: candidate.content,
    language: candidate.language,
    size,
  }
}

function asCurrentFileContentResult(value: unknown): FileContentReadResult | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<FileContentReadResult>
  if (candidate.ok === true && typeof candidate.data === 'object' && candidate.data !== null) {
    const data = asLegacyFileContentResult(candidate.data)
    if (data !== null) {
      return { ok: true, data }
    }
    return null
  }
  if (
    candidate.ok === false &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.code === 'string' &&
    typeof candidate.error.message === 'string'
  ) {
    return {
      ok: false,
      error: {
        code: candidate.error.code,
        message: candidate.error.message,
      },
    }
  }
  return null
}

/**
 * Normalize IPC read-file-content payloads.
 *
 * During migration windows, renderer/main may briefly disagree on contract
 * shape (`{ ok, data }` vs legacy `{ content, language, size }`). This adapter
 * keeps read paths resilient and returns a single stable result shape.
 */
export function normalizeFileContentReadResult(value: unknown): FileContentReadResult {
  const current = asCurrentFileContentResult(value)
  if (current !== null) return current

  const legacy = asLegacyFileContentResult(value)
  if (legacy !== null) {
    return {
      ok: true,
      data: legacy,
    }
  }

  return {
    ok: false,
    error: {
      code: 'internal_error',
      message: 'Invalid read-file-content IPC response',
    },
  }
}
