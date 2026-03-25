// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  mockQuit: vi.fn(),
  mockExit: vi.fn(),
  mockWindowDestroy: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    quit: electronMocks.mockQuit,
    exit: electronMocks.mockExit,
  },
  BrowserWindow: {
    getAllWindows: () => [{ destroy: electronMocks.mockWindowDestroy }],
  },
}))

import { executeShutdown } from '../../../electron/app/appShutdown'

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => resolve()))
}

describe('executeShutdown', () => {
  it('shuts down orchestrator before disposing native capabilities', async () => {
    electronMocks.mockQuit.mockClear()
    electronMocks.mockExit.mockClear()
    electronMocks.mockWindowDestroy.mockClear()

    const callOrder: string[] = []

    executeShutdown({
      trayManager: { destroy: vi.fn() } as never,
      hookSource: { stop: vi.fn() } as never,
      statsSource: { stop: vi.fn() } as never,
      taskSource: { stop: vi.fn() } as never,
      inboxService: { stop: vi.fn() } as never,
      webhookService: { stop: vi.fn() } as never,
      telegramBotManager: { stopAll: vi.fn() } as never,
      timeResolver: { stop: vi.fn() } as never,
      retryScheduler: { cancelAll: vi.fn() } as never,
      gitService: { shutdown: vi.fn() } as never,
      nativeCapabilityRegistry: {
        disposeAll: vi.fn(async () => {
          callOrder.push('native')
        }),
      } as never,
      capabilityCenter: { dispose: vi.fn() } as never,
      browserService: { dispose: vi.fn().mockResolvedValue(undefined) } as never,
      terminalService: { killAll: vi.fn() } as never,
      orchestrator: {
        shutdown: vi.fn(async () => {
          callOrder.push('orchestrator')
        }),
      } as never,
      database: { close: vi.fn().mockResolvedValue(undefined) } as never,
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(callOrder).toEqual(['orchestrator', 'native'])
    expect(electronMocks.mockQuit).toHaveBeenCalledTimes(1)
  })
})
