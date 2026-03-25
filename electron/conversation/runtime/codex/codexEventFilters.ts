// SPDX-License-Identifier: Apache-2.0

import type { RuntimeDiagnosticPayload } from '../events'

const LAGGED_EVENT_STREAM_RE = /event stream lagged;\s*dropped\s+\d+\s+events?/i
const LONG_THREAD_COMPACTION_ADVISORY_RE =
  /heads up:.*long threads.*multiple compactions.*less accurate/i
const RECONNECTING_RE = /^Reconnecting\.\.\.\s+\d+\/\d+/i

type CodexDiagnosticCode =
  | 'codex.event_stream_lag'
  | 'codex.long_thread_compaction_advisory'
  | 'codex.reconnecting'

interface CodexDiagnosticRule {
  readonly code: CodexDiagnosticCode
  readonly severity: RuntimeDiagnosticPayload['severity']
  readonly terminal: boolean
  readonly source: string
  readonly pattern: RegExp
}

const CODEX_DIAGNOSTIC_RULES: readonly CodexDiagnosticRule[] = [
  {
    code: 'codex.event_stream_lag',
    severity: 'warning',
    terminal: false,
    source: 'codex.transport',
    pattern: LAGGED_EVENT_STREAM_RE,
  },
  {
    code: 'codex.long_thread_compaction_advisory',
    severity: 'warning',
    terminal: false,
    source: 'codex.thread',
    pattern: LONG_THREAD_COMPACTION_ADVISORY_RE,
  },
  {
    code: 'codex.reconnecting',
    severity: 'warning',
    terminal: false,
    source: 'codex.transport',
    pattern: RECONNECTING_RE,
  },
] as const

function normalizeCodexErrorMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ')
}

export function classifyCodexErrorMessage(message: string | undefined): RuntimeDiagnosticPayload | null {
  if (!message) return null
  const normalizedMessage = normalizeCodexErrorMessage(message)
  for (const rule of CODEX_DIAGNOSTIC_RULES) {
    if (!rule.pattern.test(normalizedMessage)) continue
    return {
      code: rule.code,
      severity: rule.severity,
      terminal: rule.terminal,
      source: rule.source,
      message: normalizedMessage,
    }
  }
  return null
}

/**
 * Codex emits transient stream-backpressure diagnostics such as:
 *   "in-process app-server event stream lagged; dropped 35 events"
 * These are transport warnings, not turn-fatal errors.
 */
export function isIgnorableCodexStreamLagError(message: string | undefined): boolean {
  return classifyCodexErrorMessage(message)?.code === 'codex.event_stream_lag'
}

/**
 * Codex can emit advisory warnings on long threads with repeated compactions:
 *   "Heads up: Long threads and multiple compactions can cause the model to be less accurate..."
 * This is an informational warning and should not terminate turn processing.
 */
export function isCodexLongThreadCompactionAdvisory(message: string | undefined): boolean {
  return classifyCodexErrorMessage(message)?.code === 'codex.long_thread_compaction_advisory'
}

export function isIgnorableCodexNonFatalError(message: string | undefined): boolean {
  const diagnostic = classifyCodexErrorMessage(message)
  return Boolean(diagnostic && !diagnostic.terminal)
}
