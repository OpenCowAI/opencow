// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { SessionOrchestrator } from '../../../electron/command/sessionOrchestrator'
import type { OrchestratorDeps } from '../../../electron/command/sessionOrchestrator'

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    dispatch: vi.fn(),
    getProxyEnv: () => ({}),
    getProviderEnv: async () => ({}),
    getCodexAuthConfig: async () => null,
    getProviderDefaultModel: () => undefined,
    getProviderDefaultReasoningEffort: () => undefined,
    getCommandDefaults: () => ({
      maxTurns: 10,
      permissionMode: 'default',
      defaultEngine: 'claude',
    }),
    store: {
      save: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
    } as unknown as OrchestratorDeps['store'],
    ...overrides,
  }
}

describe('SessionOrchestrator.shutdown - Codex native bridge cleanup', () => {
  it('disposes codex native bridge manager during shutdown', async () => {
    const bridgeDispose = vi.fn().mockResolvedValue(undefined)
    const orchestrator = new SessionOrchestrator(
      makeDeps({
        codexNativeBridgeManager: {
          dispose: bridgeDispose,
        } as never,
      }),
    )

    await orchestrator.shutdown()

    expect(bridgeDispose).toHaveBeenCalledTimes(1)
  })

  it('does not throw when bridge dispose fails', async () => {
    const orchestrator = new SessionOrchestrator(
      makeDeps({
        codexNativeBridgeManager: {
          dispose: vi.fn().mockRejectedValue(new Error('dispose failed')),
        } as never,
      }),
    )

    await expect(orchestrator.shutdown()).resolves.toBeUndefined()
  })
})

