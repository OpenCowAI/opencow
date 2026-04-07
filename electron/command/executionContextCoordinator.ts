// SPDX-License-Identifier: Apache-2.0

import type { DataBusEvent, SessionExecutionContext, SessionSnapshot } from '../../src/shared/types'
import type { GitCommandExecutor } from '../services/git/gitCommandExecutor'
import { createLogger } from '../platform/logger'
import { resolveExecutionContext } from './resolveExecutionContext'
import type { SessionExecutionContextSignal } from './sessionLifecycle'

const log = createLogger('ExecutionContextCoordinator')

interface ExecutionContextSession {
  updateExecutionContext(ctx: SessionExecutionContext): boolean
  snapshot(): SessionSnapshot
}

interface SignalOrderKey {
  occurredAtMs: number
  seq: number
}

function compareSignalOrder(a: SignalOrderKey, b: SignalOrderKey): number {
  if (a.occurredAtMs !== b.occurredAtMs) return a.occurredAtMs - b.occurredAtMs
  return a.seq - b.seq
}

function normalizeOccurredAtMs(value: number | undefined): number {
  if (value == null) return Date.now()
  if (!Number.isFinite(value) || value <= 0) return Date.now()
  return Math.trunc(value)
}

type ResolveExecutionContextFn = (cwd: string) => Promise<SessionExecutionContext>

export interface ExecutionContextCoordinatorDeps {
  sessionId: string
  session: ExecutionContextSession
  projectPath: string | null
  gitExecutor: GitCommandExecutor | null
  dispatch: (event: DataBusEvent) => void
  persistSession: () => Promise<void>
  resolveExecutionContext?: ResolveExecutionContextFn
}

/**
 * Coordinates asynchronous execution-context updates from multiple runtime signals.
 *
 * Guarantees monotonic application order by event-time key:
 * - newer occurredAtMs always wins over older signals
 * - tie-breaker for equal occurredAtMs is arrival seq
 *
 * This prevents stale async resolves from overriding a newer cwd.
 */
export class ExecutionContextCoordinator {
  private nextSignalSeq = 1
  private latestSignalKey: SignalOrderKey | null = null
  private readonly resolveFn: ResolveExecutionContextFn

  constructor(private readonly deps: ExecutionContextCoordinatorDeps) {
    this.resolveFn = deps.resolveExecutionContext ?? ((cwd) =>
      resolveExecutionContext(cwd, deps.projectPath, deps.gitExecutor))
  }

  notify(signal: SessionExecutionContextSignal): void {
    const cwd = signal.cwd.trim()
    if (!cwd) return

    const key: SignalOrderKey = {
      occurredAtMs: normalizeOccurredAtMs(signal.occurredAtMs),
      seq: this.nextSignalSeq++,
    }
    if (this.latestSignalKey && compareSignalOrder(key, this.latestSignalKey) < 0) {
      return
    }
    this.latestSignalKey = key
    void this.resolveAndApply(cwd, signal.source, key)
  }

  private isStale(key: SignalOrderKey): boolean {
    if (!this.latestSignalKey) return false
    return compareSignalOrder(key, this.latestSignalKey) < 0
  }

  private async resolveAndApply(
    cwd: string,
    source: SessionExecutionContextSignal['source'],
    key: SignalOrderKey,
  ): Promise<void> {
    try {
      const resolvedCtx = await this.resolveFn(cwd)
      if (this.isStale(key)) return
      if (!this.deps.session.updateExecutionContext(resolvedCtx)) return

      this.deps.dispatch({ type: 'command:session:updated', payload: this.deps.session.snapshot() })
      this.deps.persistSession().catch((err) =>
        log.error(`Failed to persist execution context update for ${this.deps.sessionId} source=${source}`, err),
      )
    } catch (err) {
      if (this.isStale(key)) return
      log.error(
        `Failed to resolve execution context for ${this.deps.sessionId} source=${source} cwd=${cwd}`,
        err,
      )
    }
  }
}
