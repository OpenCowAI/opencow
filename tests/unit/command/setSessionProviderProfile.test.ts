// SPDX-License-Identifier: Apache-2.0
/**
 * ε.4 — SessionOrchestrator.setSessionProviderProfile()
 *
 * Backend pin/unpin contract. UI work (renderer picker, "apply default
 * to existing sessions" prompt) is a follow-up; this just verifies the
 * IPC-backed method behaves correctly against a live orchestrator.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Kysely } from 'kysely'

import { SessionOrchestrator, type OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'
import { ManagedSessionStore } from '../../../electron/services/managedSessionStore'
import type { Database } from '../../../electron/database/types'
import type { DataBusEvent, ManagedSessionInfo } from '../../../src/shared/types'
import { asProviderProfileId } from '../../../src/shared/providerProfile'
import { createTestDb } from '../../helpers/testDb'

function makeDeps(db: Kysely<Database>): OrchestratorDeps {
  return {
    dispatch: vi.fn(),
    getProxyEnv: () => ({}),
    getProviderEnv: async () => ({}),
    getProviderDefaultModel: () => undefined,
    getActiveProviderProfileId: () => null,
    getCommandDefaults: () => ({
      maxTurns: 10,
      permissionMode: 'default' as const,
      defaultEngine: 'claude',
    }),
    store: new ManagedSessionStore(db),
  }
}

describe('SessionOrchestrator.setSessionProviderProfile (ε.4)', () => {
  let tmpDir: string
  let db: Kysely<Database>
  let closeDb: () => Promise<void>
  let orchestrator: SessionOrchestrator
  let deps: OrchestratorDeps

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ccb-ep4-'))
    ;({ db, close: closeDb } = await createTestDb())
    deps = makeDeps(db)
    orchestrator = new SessionOrchestrator(deps)
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    await closeDb()
    await rm(tmpDir, { recursive: true, force: true })
  })

  function persistInfo(info: ManagedSessionInfo): Promise<void> {
    return deps.store.save(info)
  }

  function makeInfo(
    id: string,
    providerProfileId: ManagedSessionInfo['providerProfileId'],
  ): ManagedSessionInfo {
    return {
      id,
      engineSessionRef: null,
      engineState: null,
      state: 'idle',
      stopReason: null,
      origin: { source: 'browser-agent' },
      projectPath: null,
      projectId: null,
      model: null,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      activeDurationMs: 0,
      activeStartedAt: null,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastInputTokens: 0,
      activity: null,
      error: null,
      executionContext: null,
      providerProfileId,
    }
  }

  it('pins a persisted session to a profile and dispatches update', async () => {
    await persistInfo(makeInfo('ccb-pin-1', null))

    const pinned = asProviderProfileId('prof_new_123')
    const ok = await orchestrator.setSessionProviderProfile('ccb-pin-1', pinned)
    expect(ok).toBe(true)

    const reloaded = await deps.store.get('ccb-pin-1')
    expect(reloaded?.providerProfileId).toBe(pinned)

    const dispatched = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls
      .map(([evt]: [DataBusEvent]) => evt)
      .filter((evt): evt is Extract<DataBusEvent, { type: 'command:session:updated' }> =>
        evt.type === 'command:session:updated',
      )
    expect(dispatched.length).toBeGreaterThanOrEqual(1)
    expect(dispatched.at(-1)?.payload.providerProfileId).toBe(pinned)
  })

  it('unpins a session by setting profileId to null', async () => {
    const existing = asProviderProfileId('prof_existing')
    await persistInfo(makeInfo('ccb-unpin-1', existing))

    const ok = await orchestrator.setSessionProviderProfile('ccb-unpin-1', null)
    expect(ok).toBe(true)

    const reloaded = await deps.store.get('ccb-unpin-1')
    expect(reloaded?.providerProfileId).toBeNull()
  })

  it('is a no-op when the value does not change', async () => {
    const pinned = asProviderProfileId('prof_same')
    await persistInfo(makeInfo('ccb-same-1', pinned))

    const dispatchCountBefore = (deps.dispatch as ReturnType<typeof vi.fn>).mock.calls.length
    const ok = await orchestrator.setSessionProviderProfile('ccb-same-1', pinned)
    expect(ok).toBe(true)

    // No new dispatch — the method exits early on equal values.
    expect((deps.dispatch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(dispatchCountBefore)
  })

  it('returns false for unknown session id', async () => {
    const ok = await orchestrator.setSessionProviderProfile(
      'ccb-nonexistent',
      asProviderProfileId('prof_ghost'),
    )
    expect(ok).toBe(false)
  })
})
