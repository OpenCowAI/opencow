// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url'
import { MessageQueue } from './messageQueue'
import type { UserMessageContent } from '../../src/shared/types'
import type { SessionLifecycle, SessionLifecycleStartInput } from './sessionLifecycle'
import type { ClaudeSessionLaunchOptions } from './sessionLaunchOptions'
import { toSdkOptions } from './sessionLaunchOptions'
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

type SdkQuery = {
  [Symbol.asyncIterator](): AsyncIterator<unknown>
  close(): Promise<void> | void
}
type SdkSession = {
  query: (params: { prompt: AsyncIterable<unknown>; options?: Record<string, unknown> }) => SdkQuery
  close: () => Promise<void> | void
}
type OpenCowAgentModule = {
  query: (params: { prompt: AsyncIterable<unknown>; options?: Record<string, unknown> }) => SdkQuery
  unstable_v2_createSession: (options: Record<string, unknown>) => SdkSession
  getBuiltInTools?: () => unknown[]
}

let _modulePromise: Promise<OpenCowAgentModule> | null = null

async function loadSdkModule(): Promise<OpenCowAgentModule> {
  if (!_modulePromise) {
    _modulePromise = (async () => {
      const entryPath = require.resolve('@opencow-ai/opencow-agent-sdk/dist/sdk.js')
      return import(pathToFileURL(entryPath).href) as Promise<OpenCowAgentModule>
    })()
  }
  return _modulePromise
}

/** Test seam: inject a mock loader without touching ESM module resolution. */
export function __setOpenClaudeModuleLoaderForTest(
  loader: (() => Promise<OpenCowAgentModule>) | null,
): void {
  _modulePromise = loader ? loader() : null
}

/**
 * Encapsulates the lifecycle of a single SDK query (child process).
 *
 * Invariant: one QueryLifecycle = one child process = one for-await loop.
 * Once stopped, the instance is discarded — never reused.
 */
export class QueryLifecycle implements SessionLifecycle {
  private _query: SdkQuery | null = null
  private _session: SdkSession | null = null
  private _started = false
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
   * @param input - Structured start input (prompt + launch options)
   * @returns AsyncIterable of SDK messages
   */
  start(input: SessionLifecycleStartInput): AsyncIterable<EngineRuntimeEventEnvelope> {
    if (this._started) throw new Error('QueryLifecycle already started')
    if (this._stopped) throw new Error('QueryLifecycle already stopped')
    this._started = true
    const initialPrompt: UserMessageContent = input.initialPrompt
    const options: ClaudeSessionLaunchOptions = input.launchOptions

    // Log initial prompt preview (first 200 + last 100 chars for long text)
    const promptPreview = summarizePrompt(initialPrompt)
    const optionKeys = Object.keys(options).sort()
    const systemPromptText = options.systemPromptPayload.text
    log.info('start', {
      promptPreview,
      optionKeys: optionKeys.join(', '),
      hasSystemPrompt: systemPromptText.length > 0,
      systemPromptLength: systemPromptText.length,
      model: options.model ?? 'default',
    })

    this.queue.push(initialPrompt)
    this.pendingTurnSeqs.push(this.nextTurnSeq++)

    const cleanup = () => {
      this._stopped = true
      if (this._query) {
        this._query.close()
      }
      this._query = null
      if (this._session) {
        void this._session.close()
      }
      this._session = null
      this.queue.close()
      this.doneResolve?.()
      this.doneResolve = null
    }
    const resolveTurnRef = (event: EngineRuntimeEvent): RuntimeTurnRef | undefined =>
      this.resolveTurnRef(event)
    const lifecycle = this
    const stream = (async function* () {
      try {
        const sdkMod = await loadSdkModule()
        const builtInTools = sdkMod.getBuiltInTools?.()
        const sdkOptions = {
          ...toSdkOptions(options),
          ...(builtInTools ? { builtInTools } : {}),
        }
        // ε.3a: go through Session-first-class API. Today this is
        // behaviourally identical to the old `sdkMod.query()` call —
        // Session.query() forwards to the same runtime under the hood.
        // The swap establishes end-to-end plumbing for ε.3b+, where
        // per-turn Session.query() calls will replace the long-lived
        // queue pattern and delete drift-detection entirely.
        const session = sdkMod.unstable_v2_createSession(sdkOptions)
        lifecycle._session = session
        const q = session.query({ prompt: lifecycle.queue })
        lifecycle._query = q
        if (lifecycle._stopped) {
          q.close()
          lifecycle._query = null
          return
        }
        for await (const message of q) {
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
    if (this._session) {
      void this._session.close()
      this._session = null
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

/** Build a compact prompt preview string (first 200 + last 100 for long text). */
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
