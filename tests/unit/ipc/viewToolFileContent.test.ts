// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBus } from '../../../electron/core/dataBus'
import { registerIPCHandlers, type IPCDeps } from '../../../electron/ipc/channels'
import { MAX_FILE_SIZE_BYTES } from '../../../src/shared/fileUtils'

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

function registerAndGetViewToolHandler(overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get('view-tool-file-content')
  if (!handler) {
    throw new Error('view-tool-file-content handler was not registered')
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

describe('IPC view-tool-file-content', () => {
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-view-tool-ipc-'))
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

  it('resolves relative path against session.executionContext.cwd', async () => {
    const projectPath = path.join(tempRoot, 'project')
    const worktreeCwd = path.join(tempRoot, 'worktree')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(worktreeCwd, { recursive: true })
    await fs.writeFile(path.join(projectPath, 'note.md'), 'project-note', 'utf-8')
    await fs.writeFile(path.join(worktreeCwd, 'note.md'), 'worktree-note', 'utf-8')

    const getSession = vi.fn(async () => ({
      executionContext: { cwd: worktreeCwd },
      projectPath,
    }))

    const handler = registerAndGetViewToolHandler({
      orchestrator: { getSession } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: ' sess-1 ', filePath: 'note.md' }) as {
      ok: true
      data: {
        content: string
        language: string
        size: number
      }
    }

    expect(getSession).toHaveBeenCalledWith('sess-1')
    expect(result.ok).toBe(true)
    expect(result.data.content).toBe('worktree-note')
    expect(result.data.language).toBe('markdown')
    expect(result.data.size).toBe('worktree-note'.length)
  })

  it('falls back to session.projectPath when executionContext is unavailable', async () => {
    const projectPath = path.join(tempRoot, 'project')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.writeFile(path.join(projectPath, 'README.md'), '# hello', 'utf-8')

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: null,
          projectPath,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'README.md' }) as {
      ok: true
      data: { content: string }
    }

    expect(result.ok).toBe(true)
    expect(result.data.content).toBe('# hello')
  })

  it('rejects traversal outside the session workspace', async () => {
    const workspace = path.join(tempRoot, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(tempRoot, 'outside.md'), 'outside', 'utf-8')

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: { cwd: workspace },
          projectPath: workspace,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: '../outside.md' })
    expectFailure(result, 'access_denied', 'Access denied: path outside session workspace')
  })

  it('rejects symlink escape outside the session workspace', async () => {
    const workspace = path.join(tempRoot, 'workspace')
    const outsideDir = path.join(tempRoot, 'outside')
    await fs.mkdir(workspace, { recursive: true })
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, 'secret.md')
    await fs.writeFile(outsideFile, '# secret', 'utf-8')
    await fs.symlink(outsideFile, path.join(workspace, 'link.md'))

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: { cwd: workspace },
          projectPath: workspace,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'link.md' })
    expectFailure(result, 'access_denied', 'Access denied: path outside session workspace')
  })

  it('rejects directory targets', async () => {
    const workspace = path.join(tempRoot, 'workspace')
    const docsDir = path.join(workspace, 'docs')
    await fs.mkdir(docsDir, { recursive: true })

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: { cwd: workspace },
          projectPath: workspace,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'docs' })
    expectFailure(result, 'directory_not_supported', 'Cannot open directory in viewer')
  })

  it('rejects binary file extensions', async () => {
    const workspace = path.join(tempRoot, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'image.png'), 'not-a-real-png', 'utf-8')

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: { cwd: workspace },
          projectPath: workspace,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'image.png' })
    expectFailure(result, 'binary_file_not_supported', 'Cannot open binary file in viewer')
  })

  it('rejects files larger than MAX_FILE_SIZE_BYTES', async () => {
    const workspace = path.join(tempRoot, 'workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'large.txt'), Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 'a'))

    const handler = registerAndGetViewToolHandler({
      orchestrator: {
        getSession: vi.fn(async () => ({
          executionContext: { cwd: workspace },
          projectPath: workspace,
        })),
      } as unknown as IPCDeps['orchestrator'],
    })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'large.txt' })
    expectFailure(result, 'file_too_large', 'File too large')
  })

  it('rejects missing orchestrator service', async () => {
    const handler = registerAndGetViewToolHandler({ orchestrator: undefined })

    const result = await handler({}, { sessionId: 'sess-1', filePath: 'a.md' })
    expectFailure(result, 'session_service_unavailable', 'Session service unavailable')
  })

  it('rejects invalid input and missing session', async () => {
    const getSession = vi.fn(async () => null)
    const handler = registerAndGetViewToolHandler({
      orchestrator: { getSession } as unknown as IPCDeps['orchestrator'],
    })

    const invalidSessionResult = await handler({}, { sessionId: '   ', filePath: 'a.md' })
    expectFailure(invalidSessionResult, 'invalid_input', 'Invalid sessionId')

    const invalidPathResult = await handler({}, { sessionId: 'sess-1', filePath: '   ' })
    expectFailure(invalidPathResult, 'invalid_input', 'Invalid filePath')

    const missingSessionResult = await handler({}, { sessionId: 'sess-404', filePath: 'a.md' })
    expectFailure(missingSessionResult, 'session_not_found', 'Session not found: sess-404')
    expect(getSession).toHaveBeenCalledWith('sess-404')
  })
})
