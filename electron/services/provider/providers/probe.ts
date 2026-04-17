// SPDX-License-Identifier: Apache-2.0

/**
 * Shared HTTP probe utility for provider adapters.
 *
 * All four protocol families (Anthropic, OpenAI, Anthropic-compat proxy,
 * Gemini) expose a token-free authenticated endpoint at `/v1/models`
 * (or the vendor's equivalent). A GET there:
 *
 *   - 200   → credentials accepted, endpoint reachable
 *   - 401   → auth failed
 *   - 403   → auth accepted, no permission (still "reachable" — we
 *             surface as unauthenticated since it blocks real use)
 *   - 4xx   → accepted request shape, credentials OK — treated as ok
 *             with a warning detail
 *   - 5xx   → upstream down
 *   - throw → network / DNS / TLS
 */

import { createLogger } from '../../../platform/logger'
import type { ProbeResult } from '../types'

const log = createLogger('Provider:Probe')

export interface ProbeRequest {
  /** Full URL including path (e.g. `https://api.anthropic.com/v1/models`). */
  url: string
  /** Header name → value. The adapter owns which header carries auth. */
  headers: Record<string, string>
  /** Label used in log lines (e.g. "Anthropic API", "OpenAI"). */
  logLabel: string
  /** Optional ms timeout. Default 10_000. */
  timeoutMs?: number
}

export async function probeUpstream(request: ProbeRequest): Promise<ProbeResult> {
  const timeoutMs = request.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    const response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: controller.signal,
    })
    const durationMs = Date.now() - started

    if (response.status === 200) {
      log.info(`Probe OK: ${request.logLabel} (${durationMs}ms)`)
      return { ok: true, detail: `${durationMs}ms` }
    }

    if (response.status === 401 || response.status === 403) {
      const bodyText = await safeReadBody(response)
      log.warn(`Probe auth fail: ${request.logLabel} status=${response.status}`, { body: bodyText })
      return {
        ok: false,
        reason: 'unauthenticated',
        message: `HTTP ${response.status}: ${truncate(bodyText) || response.statusText}`,
      }
    }

    if (response.status >= 500) {
      log.warn(`Probe upstream error: ${request.logLabel} status=${response.status}`)
      return {
        ok: false,
        reason: 'error',
        message: `Upstream returned HTTP ${response.status}`,
      }
    }

    // 4xx other than 401/403: the server accepted the request but
    // rejected the shape (e.g. missing required header, unknown path).
    // Auth isn't the problem — treat as ok with a warning detail.
    log.info(`Probe accepted (non-200): ${request.logLabel} status=${response.status}`)
    return {
      ok: true,
      detail: `HTTP ${response.status} (auth accepted, non-fatal)`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    log.warn(
      `Probe ${isAbort ? 'timeout' : 'network error'}: ${request.logLabel}`,
      { error: message },
    )
    return {
      ok: false,
      reason: 'network',
      message: isAbort ? `Timed out after ${timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim()
  } catch {
    return ''
  }
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}
