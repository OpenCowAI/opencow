// SPDX-License-Identifier: Apache-2.0

/**
 * Schedule Startup Cleanup — cancel orphaned executions from previous crashes.
 *
 * When the app is force-quit or crashes, execution records may be stuck in
 * `running` state forever.  At startup, any execution whose session is NOT
 * currently active is definitively orphaned — this module cancels them all
 * in one batch.
 *
 * This is extracted from main.ts to keep startup logic focused and to make
 * the cleanup logic independently testable.
 */

import { createLogger } from '../platform/logger'
import type { DataBus } from '../core/dataBus'
import type { ExecutionStore } from '../services/executionStore'
import type { SessionOrchestrator } from '../command/sessionOrchestrator'

const log = createLogger('ScheduleCleanup')

/** Session states that indicate an execution is still alive. */
const ACTIVE_STATES = new Set(['streaming', 'awaiting_input', 'awaiting_question', 'creating'])

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleCleanupDeps {
  executionStore: ExecutionStore
  orchestrator: SessionOrchestrator
  bus: DataBus
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Batch-cancel all executions stuck in `running` state that no longer have
 * an active session backing them.
 *
 * Best-effort — failures are logged but never propagated.
 */
export async function cleanupOrphanedExecutions(deps: ScheduleCleanupDeps): Promise<void> {
  const { executionStore, orchestrator, bus } = deps

  try {
    const staleExecs = await executionStore.listAllRunning()
    if (staleExecs.length === 0) return

    // Check all sessions in parallel (independent DB lookups)
    const liveFlags = await Promise.all(
      staleExecs.map(async (exec) => {
        if (!exec.sessionId) return false
        try {
          const session = await orchestrator.getSession(exec.sessionId)
          return session !== null && ACTIVE_STATES.has(session.state)
        } catch {
          return false
        }
      }),
    )

    const orphaned = staleExecs.filter((_, i) => !liveFlags[i])
    if (orphaned.length === 0) return

    const now = Date.now()
    await executionStore.batchCancelOrphaned(orphaned.map((e) => e.id), now)

    // Broadcast events so renderer Zustand cache stays in sync
    for (const exec of orphaned) {
      bus.dispatch({
        type: 'schedule:executed',
        payload: {
          scheduleId: exec.scheduleId,
          execution: {
            ...exec,
            status: 'cancelled' as const,
            completedAt: now,
            durationMs: now - exec.startedAt,
          },
        },
      })
    }

    log.info(`Startup cleanup: batch-cancelled ${orphaned.length} orphaned executions`)
  } catch (err) {
    log.error('Startup cleanup failed', err)
  }
}
