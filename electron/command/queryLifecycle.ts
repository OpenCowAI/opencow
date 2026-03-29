// SPDX-License-Identifier: Apache-2.0

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { MessageQueue } from './messageQueue'
import type { UserMessageContent } from '../../src/shared/types'
import type { SessionLifecycle } from './sessionLifecycle'
import { adaptClaudeSdkMessage } from '../conversation/runtime/claudeRuntimeAdapter'
import {
  createRuntimeEventEnvelope,
  isTurnScopedRuntimeEventKind,
  type EngineRuntimeEvent,
  type EngineRuntimeEventEnvelope,
  type RuntimeTurnRef,
} from '../conversation/runtime/events'
import { createLogger } from '../platform/logger'

const log = createLogger('QueryLifecycle')

/** Safety timeout (ms) for stop() — last resort if SDK hangs. */
const STOP_SAFETY_TIMEOUT_MS = 30_000

/**
 * Encapsulates the lifecycle of a single SDK query (child process).
 *
 * Invariant: one QueryLifecycle = one child process = one for-await loop.
 * Once stopped, the instance is discarded — never reused.
 */
export class QueryLifecycle implements SessionLifecycle {
  private _query: Query | null = null
  private readonly queue: MessageQueue
  private doneResolve: (() => void) | null = null
  private readonly donePromise: Promise<void>
  private _stopped = false
  private nextTurnSeq = 1
  private pendingTurnSeqs: number[] = []
  private activeTurnSeq: number | null = null
  private lastCompletedTurnSeq: number | null = null

  constructor() {
    this.queue = new MessageQueue()
    this.donePromise = new Promise<void>((resolve) => {
      this.doneResolve = resolve
    })
  }

  get stopped(): boolean {
    return this._stopped
  }

  /**
   * Start the SDK query and return a message stream.
   * Must be called exactly once per instance.
   *
   * @param initialPrompt - First user message to push into the queue
   * @param options - SDK query options (abortController is NOT needed — lifecycle manages cleanup via close())
   * @returns AsyncIterable of SDK messages
   */
  start(
    initialPrompt: UserMessageContent,
    options: Record<string, unknown>
  ): AsyncIterable<EngineRuntimeEventEnvelope> {
    if (this._query) throw new Error('QueryLifecycle already started')
    if (this._stopped) throw new Error('QueryLifecycle already stopped')

    // Log initial prompt preview (Codex-style: first 200 + last 100 chars)
    const promptPreview = summarizePrompt(initialPrompt)
    const optionKeys = Object.keys(options).sort()
    log.info('start', {
      promptPreview,
      optionKeys: optionKeys.join(', '),
      hasSystemPrompt: !!options.systemPrompt,
      systemPromptLength: typeof options.systemPrompt === 'string' ? options.systemPrompt.length : 0,
      model: options.model ?? 'default',
    })

    this.queue.push(initialPrompt)
    this.pendingTurnSeqs.push(this.nextTurnSeq++)

    const q = sdkQuery({ prompt: this.queue, options })
    this._query = q

    const cleanup = () => {
      this._stopped = true
      // Close the SDK child process if stop() hasn't already done so.
      // When the stream ends naturally (idle/completed), stop() is never called,
      // so we MUST close here to prevent file descriptor leaks (spawn EBADF).
      // When stop() was called first, it sets _query = null before this runs,
      // so the guard prevents double-close.
      if (this._query) {
        this._query.close()
      }
      this._query = null
      this.queue.close()
      this.doneResolve?.()
      this.doneResolve = null
    }
    const resolveTurnRef = (event: EngineRuntimeEvent): RuntimeTurnRef | undefined =>
      this.resolveTurnRef(event)
    const stream = (async function* () {
      try {
        for await (const message of q as AsyncIterable<SDKMessage>) {
          const events = adaptClaudeSdkMessage(message)
          for (const event of events) {
            yield createRuntimeEventEnvelope({
              engine: 'claude',
              event,
              turnRef: resolveTurnRef(event),
            })
          }
        }
      } finally {
        cleanup()
      }
    })()

    return stream
  }

  /**
   * Push a follow-up user message (for awaiting_input state).
   * Silently ignored if lifecycle is stopped.
   */
  pushMessage(content: UserMessageContent): void {
    if (this._stopped) return
    log.debug('pushMessage', { turnSeq: this.nextTurnSeq, preview: summarizePrompt(content) })
    this.queue.push(content)
    this.pendingTurnSeqs.push(this.nextTurnSeq++)
  }

  /**
   * Stop the query and wait for the message stream to terminate.
   * Idempotent — safe to call multiple times, before start(), or after natural completion.
   *
   * Uses query.close() as the SOLE cleanup mechanism.
   * close() terminates the child process and all its stdio,
   * which causes the for-await generator to hit its finally block.
   */
  async stop(): Promise<void> {
    if (this._stopped) return
    log.info('stop', { turnsCompleted: this.lastCompletedTurnSeq ?? 0, pendingTurns: this.pendingTurnSeqs.length })
    this._stopped = true

    if (this._query) {
      this._query.close()
      this._query = null
    } else {
      // Generator was never started — resolve done immediately
      this.doneResolve?.()
      this.doneResolve = null
    }
    this.queue.close()

    // Wait for the generator's finally block to run.
    // Safety timeout prevents permanent hang if SDK has a bug.
    let timer: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      this.donePromise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_SAFETY_TIMEOUT_MS)
      })
    ])
    if (timer !== null) clearTimeout(timer)
  }

  private dequeueTurnSeq(): number {
    const seq = this.pendingTurnSeqs.shift()
    if (seq != null) return seq
    const fallback = this.nextTurnSeq
    this.nextTurnSeq += 1
    return fallback
  }

  private resolveTurnRef(event: EngineRuntimeEvent): RuntimeTurnRef | undefined {
    if (!isTurnScopedRuntimeEventKind(event.kind)) return undefined

    if (event.kind === 'turn.started') {
      const turnSeq = this.dequeueTurnSeq()
      this.activeTurnSeq = turnSeq
      return { turnSeq }
    }

    if (this.activeTurnSeq == null) {
      if (event.kind === 'turn.usage' && this.lastCompletedTurnSeq != null) {
        return { turnSeq: this.lastCompletedTurnSeq }
      }
      this.activeTurnSeq = this.dequeueTurnSeq()
    }

    const turnSeq = this.activeTurnSeq
    if (event.kind === 'turn.result') {
      this.lastCompletedTurnSeq = turnSeq
      this.activeTurnSeq = null
    }
    return { turnSeq }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a compact prompt preview string (Codex-style: first 200 + last 100 for long text). */
function summarizePrompt(content: UserMessageContent): string {
  const text = typeof content === 'string'
    ? content
    : content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
  if (text.length <= 300) return text.replace(/\n/g, '\\n')
  return `${text.slice(0, 200)}...[${text.length} chars]...${text.slice(-100)}`.replace(/\n/g, '\\n')
}
