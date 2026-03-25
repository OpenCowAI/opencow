// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  classifyCodexErrorMessage,
  isCodexLongThreadCompactionAdvisory,
  isIgnorableCodexNonFatalError,
  isIgnorableCodexStreamLagError,
} from '../../../electron/conversation/runtime/codex/codexEventFilters'

describe('codexEventFilters', () => {
  it('detects lag stream diagnostics as non-fatal', () => {
    const message = 'in-process app-server event stream lagged; dropped 35 events'
    expect(isIgnorableCodexStreamLagError(message)).toBe(true)
    expect(isIgnorableCodexNonFatalError(message)).toBe(true)
  })

  it('detects long-thread compaction advisory as non-fatal', () => {
    const message = 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.'
    expect(isCodexLongThreadCompactionAdvisory(message)).toBe(true)
    expect(isIgnorableCodexNonFatalError(message)).toBe(true)
  })

  it('classifies known diagnostics with structured payload', () => {
    const message = 'Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible to keep threads small and targeted.'
    const diagnostic = classifyCodexErrorMessage(message)
    expect(diagnostic).toEqual({
      code: 'codex.long_thread_compaction_advisory',
      severity: 'warning',
      terminal: false,
      source: 'codex.thread',
      message,
    })
  })

  it('detects reconnecting retry messages as non-fatal', () => {
    const message = 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable: Service temporarily unavailable, url: http://example.com/responses, request id: abc-123)'
    expect(isIgnorableCodexNonFatalError(message)).toBe(true)
    const diagnostic = classifyCodexErrorMessage(message)
    expect(diagnostic).toMatchObject({
      code: 'codex.reconnecting',
      severity: 'warning',
      terminal: false,
      source: 'codex.transport',
    })
  })

  it('detects reconnecting retry messages with various retry counts', () => {
    expect(isIgnorableCodexNonFatalError('Reconnecting... 3/5 (network error)')).toBe(true)
    expect(isIgnorableCodexNonFatalError('Reconnecting... 5/5 (timeout)')).toBe(true)
  })

  it('does not mark genuine execution errors as non-fatal', () => {
    const message = 'Command failed with exit code 2'
    expect(isIgnorableCodexStreamLagError(message)).toBe(false)
    expect(isCodexLongThreadCompactionAdvisory(message)).toBe(false)
    expect(isIgnorableCodexNonFatalError(message)).toBe(false)
    expect(classifyCodexErrorMessage(message)).toBeNull()
  })
})
