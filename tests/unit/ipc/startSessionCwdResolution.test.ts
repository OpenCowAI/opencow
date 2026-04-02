// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBus } from '../../../electron/core/dataBus'
import { registerIPCHandlers, type IPCDeps } from '../../../electron/ipc/channels'

const electronMocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  getAllWindows: vi.fn(() => []),
  appGetLocale: vi.fn(() => 'en-US'),
  appRelaunch: vi.fn(),
  appQuit: vi.fn(),
  clipboardWriteText: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.ipcHandle },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  app: {
    getLocale: electronMocks.appGetLocale,
    relaunch: electronMocks.appRelaunch,
    quit: electronMocks.appQuit,
  },
  clipboard: {
    writeText: electronMocks.clipboardWriteText,
  },
}))

type RegisteredHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const registeredHandlers = new Map<string, RegisteredHandler>()

function createDeps(overrides: Partial<IPCDeps> = {}): IPCDeps {
  return {
    bus: new DataBus(),
    onboarding: {
      load: vi.fn(async () => ({ completed: false, hooksInstalled: false })),
      complete: vi.fn(async () => ({ completed: true, hooksInstalled: true })),
      setHooksInstalled: vi.fn(async (installed: boolean) => ({
        completed: false,
        hooksInstalled: installed,
      })),
    } as unknown as IPCDeps['onboarding'],
    dataPaths: {
      root: '/tmp',
      hooks: '/tmp',
      eventLogger: '/tmp/event-logger.sh',
      eventsLog: '/tmp/events.jsonl',
      database: '/tmp/db.sqlite',
      settings: '/tmp/settings.json',
      onboarding: '/tmp/onboarding.json',
      logs: '/tmp/logs',
      credentials: '/tmp/credentials.enc',
      capabilities: '/tmp/capabilities',
      repoSourceCredentials: '/tmp/repo-credentials.enc',
    },
    hookEnv: 'development',
    ...overrides,
  }
}

function registerAndGetStartSessionHandler(overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get('command:start-session')
  if (!handler) throw new Error('command:start-session handler was not registered')
  return handler
}

describe('IPC command:start-session — workspace forwarding', () => {
  beforeEach(() => {
    registeredHandlers.clear()
    electronMocks.ipcHandle.mockReset()
    electronMocks.ipcHandle.mockImplementation((channel: string, handler: RegisteredHandler) => {
      registeredHandlers.set(channel, handler)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes project workspace through to orchestrator', async () => {
    const startSession = vi.fn(async () => 'session-1')
    const handler = registerAndGetStartSessionHandler({
      orchestrator: { startSession } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, {
      prompt: 'hello',
      workspace: { scope: 'project', projectId: 'proj-1' },
    })

    expect(result).toBe('session-1')
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { scope: 'project', projectId: 'proj-1' },
      }),
    )
  })

  it('passes custom-path workspace through to orchestrator', async () => {
    const startSession = vi.fn(async () => 'session-1')
    const handler = registerAndGetStartSessionHandler({
      orchestrator: { startSession } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, {
      prompt: 'hello',
      workspace: { scope: 'custom-path', cwd: '/tmp/proj-explicit' },
    })

    expect(result).toBe('session-1')
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: { scope: 'custom-path', cwd: '/tmp/proj-explicit' },
      }),
    )
  })
})
