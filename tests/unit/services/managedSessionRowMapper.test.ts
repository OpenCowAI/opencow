// SPDX-License-Identifier: Apache-2.0
/**
 * ε.3b — Round-trip test for the new `provider_profile_id` column.
 */

import { describe, expect, it } from 'vitest'

import type { ManagedSessionInfo } from '../../../src/shared/types'
import { asProviderProfileId } from '../../../src/shared/providerProfile'
import {
  managedSessionInfoToRow,
  managedSessionRowToInfo,
} from '../../../electron/services/mappers/managedSessionRowMapper'

function baseInfo(
  providerProfileId: ManagedSessionInfo['providerProfileId'],
): ManagedSessionInfo {
  return {
    id: 'ccb-test-000000',
    engineSessionRef: null,
    engineState: null,
    state: 'idle',
    stopReason: null,
    origin: { source: 'browser-agent' },
    projectPath: null,
    projectId: null,
    model: null,
    messages: [],
    createdAt: 0,
    lastActivity: 0,
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

describe('managedSessionRowMapper — providerProfileId (ε.3b)', () => {
  it('roundtrips null as "follow default" binding', () => {
    const info = baseInfo(null)
    const row = managedSessionInfoToRow(info)
    expect(row.provider_profile_id).toBeNull()
    const restored = managedSessionRowToInfo(row)
    expect(restored.providerProfileId).toBeNull()
  })

  it('roundtrips a pinned profile id', () => {
    const pinned = asProviderProfileId('prof_abc123')
    const info = baseInfo(pinned)
    const row = managedSessionInfoToRow(info)
    expect(row.provider_profile_id).toBe('prof_abc123')
    const restored = managedSessionRowToInfo(row)
    expect(restored.providerProfileId).toBe('prof_abc123')
  })

  it('treats legacy rows with empty-string id as null (defensive)', () => {
    const row = managedSessionInfoToRow(baseInfo(null))
    // Simulate a legacy row that somehow wrote '' instead of NULL.
    const restored = managedSessionRowToInfo({
      ...row,
      provider_profile_id: '',
    })
    expect(restored.providerProfileId).toBeNull()
  })
})
