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

function registerAndGetHandler(channel: string, overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get(channel)
  if (!handler) {
    throw new Error(`${channel} handler was not registered`)
  }
  return handler
}

describe('IPC project listing order consistency', () => {
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

  it('returns projects in exactly the same order as projectService.listAll across IPC entry points', async () => {
    const listAll = vi.fn(async () => [
      {
        id: 'pin-1',
        name: 'Pinned One',
        canonicalPath: '/tmp/pin-1',
        pinOrder: 0,
        archivedAt: null,
        displayOrder: 2,
        createdAt: 1,
        updatedAt: 300,
        preferences: {
          defaultTab: 'issues',
          defaultChatViewMode: 'default',
          defaultFilesDisplayMode: 'ide',
        },
      },
      {
        id: 'active-2',
        name: 'Active Two',
        canonicalPath: '/tmp/active-2',
        pinOrder: null,
        archivedAt: null,
        displayOrder: 1,
        createdAt: 1,
        updatedAt: 100,
        preferences: {
          defaultTab: 'issues',
          defaultChatViewMode: 'default',
          defaultFilesDisplayMode: 'ide',
        },
      },
      {
        id: 'active-1',
        name: 'Active One',
        canonicalPath: '/tmp/active-1',
        pinOrder: null,
        archivedAt: null,
        displayOrder: 0,
        createdAt: 1,
        updatedAt: 200,
        preferences: {
          defaultTab: 'issues',
          defaultChatViewMode: 'default',
          defaultFilesDisplayMode: 'ide',
        },
      },
      {
        id: 'arch-1',
        name: 'Archived One',
        canonicalPath: '/tmp/arch-1',
        pinOrder: null,
        archivedAt: 999,
        displayOrder: 9,
        createdAt: 1,
        updatedAt: 400,
        preferences: {
          defaultTab: 'issues',
          defaultChatViewMode: 'default',
          defaultFilesDisplayMode: 'ide',
        },
      },
    ])

    const expectedOrder = ['pin-1', 'active-2', 'active-1', 'arch-1']
    const projectService = {
      listAll,
    } as unknown as IPCDeps['projectService']

    const initialStateHandler = registerAndGetHandler('get-initial-state', {
      projectService: {
        listAll,
      } as unknown as IPCDeps['projectService'],
    })
    const listAllProjectsHandler = registerAndGetHandler('list-all-projects', {
      projectService,
    })

    const initialState = await initialStateHandler({}) as { projects: Array<{ id: string }> }
    const listAllProjects = await listAllProjectsHandler({}) as Array<{ id: string }>

    expect(initialState.projects.map((p) => p.id)).toEqual(expectedOrder)
    expect(listAllProjects.map((p) => p.id)).toEqual(expectedOrder)
  })
})
