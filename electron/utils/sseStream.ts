// SPDX-License-Identifier: Apache-2.0

/**
 * SSE stream parser — pure async generator, no side effects.
 *
 * Reads a streaming HTTP Response body and yields parsed JSON events
 * from `data:` lines. Handles chunked boundaries and skips the `[DONE]`
 * sentinel used by Evose SSE endpoints.
 *
 * Error propagation: JSON.parse errors are intentionally NOT caught here.
 * They propagate to the caller's for-await loop and should be handled
 * by the caller's try/catch (e.g., runAgent / runWorkflow).
 *
 * Reusable for both Agent and Workflow streaming responses.
 */

/** Default fallback type when no type parameter is provided (backward-compatible with legacy callers) */
export interface SseEvent {
  type: string
  [key: string]: unknown
}

/**
 * Generic SSE stream parser.
 *
 * Type parameter T allows callers to pass a specific discriminated union type for full type safety:
 *   for await (const event of parseSseStream<MyEvent>(response)) { ... }
 *
 * When T is not provided, it falls back to SseEvent (backward-compatible).
 */
export async function* parseSseStream<T = SseEvent>(response: Response): AsyncGenerator<T> {
  // Defensive guard: SSE requires a readable body stream
  if (!response.body) {
    throw new Error('Response body is null — SSE streaming not supported in this environment')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''  // Keep the potentially incomplete last line

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw && raw !== '[DONE]') {
        // JSON.parse errors propagate to caller — intentional, not a bug
        yield JSON.parse(raw) as T
      }
    }
  }
}
