// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

function registerAndGetSaveFileHandler(overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get('save-file-content')
  if (!handler) {
    throw new Error('save-file-content handler was not registered')
  }
  return handler
}

function expectFailure(
  result: unknown,
  expectedCode: string,
  expectedMessageIncludes: string,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: expectedCode,
    },
  })
  expect((result as { ok: false; error: { message: string } }).error.message).toContain(
    expectedMessageIncludes,
  )
}

describe('IPC save-file-content security', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-save-file-ipc-'))
    registeredHandlers.clear()
    electronMocks.ipcHandle.mockReset()
    electronMocks.ipcHandle.mockImplementation((channel: string, handler: RegisteredHandler) => {
      registeredHandlers.set(channel, handler)
    })
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('writes file content within project directory', async () => {
    const projectPath = path.join(tempRoot, 'project')
    const srcDir = path.join(projectPath, 'src')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(srcDir, { recursive: true })
    const handler = registerAndGetSaveFileHandler()

    const result = await handler({}, projectPath, 'src/index.ts', 'export const ok = true\n')

    expect(result).toEqual({ ok: true, data: { saved: true } })
    await expect(fs.readFile(path.join(projectPath, 'src/index.ts'), 'utf-8')).resolves.toContain('ok = true')
  })

  it('rejects writing through symbolic link target', async () => {
    const projectPath = path.join(tempRoot, 'project')
    const outsidePath = path.join(tempRoot, 'outside.txt')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.writeFile(outsidePath, 'outside-before', 'utf-8')
    await fs.symlink(outsidePath, path.join(projectPath, 'linked.txt'))

    const handler = registerAndGetSaveFileHandler()

    const result = await handler({}, projectPath, 'linked.txt', 'inside-write')
    expectFailure(result, 'symlink_blocked', 'Cannot write through symbolic link')
    await expect(fs.readFile(outsidePath, 'utf-8')).resolves.toBe('outside-before')
  })

  it('rejects writes when parent directory escapes project via symlink', async () => {
    const projectPath = path.join(tempRoot, 'project')
    const outsideDir = path.join(tempRoot, 'outside-dir')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    await fs.symlink(outsideDir, path.join(projectPath, 'nested'))

    const handler = registerAndGetSaveFileHandler()

    const result = await handler({}, projectPath, 'nested/leak.txt', 'blocked')
    expectFailure(result, 'access_denied', 'Access denied: path outside project directory')
    await expect(fs.readFile(path.join(outsideDir, 'leak.txt'), 'utf-8')).rejects.toBeDefined()
  })
})
