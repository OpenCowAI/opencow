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

function registerAndGetBundleViewerHandler(overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get('capability:view-bundle-file-content')
  if (!handler) {
    throw new Error('capability:view-bundle-file-content handler was not registered')
  }
  return handler
}

function registerAndGetBundleListHandler(overrides: Partial<IPCDeps> = {}): RegisteredHandler {
  registerIPCHandlers(createDeps(overrides))
  const handler = registeredHandlers.get('capability:bundle-files')
  if (!handler) {
    throw new Error('capability:bundle-files handler was not registered')
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

describe('IPC capability:view-bundle-file-content', () => {
  let tempRoot: string
  let projectRoot: string
  let skillFilePath: string
  let resolveProjectPathFromId: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-cap-bundle-ipc-'))
    projectRoot = path.join(tempRoot, 'project')
    skillFilePath = path.join(projectRoot, '.opencow-dev', 'skills', 'alpha', 'SKILL.md')
    await fs.mkdir(path.dirname(skillFilePath), { recursive: true })
    await fs.writeFile(skillFilePath, '# alpha', 'utf-8')

    registeredHandlers.clear()
    electronMocks.ipcHandle.mockReset()
    electronMocks.ipcHandle.mockImplementation((channel: string, handler: RegisteredHandler) => {
      registeredHandlers.set(channel, handler)
    })

    resolveProjectPathFromId = vi.fn(async () => projectRoot)
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('reads bundle file content via project-scoped relative path', async () => {
    const scriptPath = path.join(path.dirname(skillFilePath), 'scripts', 'run.sh')
    await fs.mkdir(path.dirname(scriptPath), { recursive: true })
    await fs.writeFile(scriptPath, 'echo "ok"\n', 'utf-8')

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: 'scripts/run.sh',
      },
    }) as {
      ok: true
      data: { content: string; language: string }
    }

    expect(resolveProjectPathFromId).toHaveBeenCalledWith('project-1')
    expect(result.ok).toBe(true)
    expect(result.data.content).toContain('echo "ok"')
    expect(result.data.language).toBe('shell')
  })

  it('rejects path traversal outside bundle root', async () => {
    const outsidePath = path.join(projectRoot, 'outside.txt')
    await fs.writeFile(outsidePath, 'outside', 'utf-8')

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: '../outside.txt',
      },
    })
    expectFailure(result, 'access_denied', 'Access denied: path outside capability bundle')
  })

  it('rejects symlink escape outside bundle root', async () => {
    const outsideDir = path.join(tempRoot, 'outside')
    await fs.mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, 'secret.md')
    await fs.writeFile(outsideFile, '# outside secret', 'utf-8')
    await fs.symlink(outsideFile, path.join(path.dirname(skillFilePath), 'linked.md'))

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: 'linked.md',
      },
    })
    expectFailure(result, 'access_denied', 'Access denied: path outside capability bundle')
  })

  it('rejects absolute relativePath input', async () => {
    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: path.join(projectRoot, 'absolute.txt'),
      },
    })
    expectFailure(result, 'invalid_input', 'Capability bundle relativePath must be relative')
  })

  it('rejects non-SKILL.md bundle roots', async () => {
    const notBundleFile = path.join(path.dirname(skillFilePath), 'README.md')
    await fs.writeFile(notBundleFile, '# not bundle root', 'utf-8')

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath: notBundleFile,
        relativePath: 'scripts/run.sh',
      },
    })
    expectFailure(result, 'invalid_input', 'Capability bundle must reference SKILL.md')
  })

  it('rejects directory targets', async () => {
    const scriptsDir = path.join(path.dirname(skillFilePath), 'scripts')
    await fs.mkdir(scriptsDir, { recursive: true })

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: 'scripts',
      },
    })
    expectFailure(result, 'directory_not_supported', 'Cannot open directory in viewer')
  })

  it('rejects bundle roots whose realpath is outside allowed capability directories', async () => {
    const outsideRoot = path.join(tempRoot, 'outside-bundle')
    await fs.mkdir(outsideRoot, { recursive: true })
    const outsideSkill = path.join(outsideRoot, 'SKILL.md')
    await fs.writeFile(outsideSkill, '# outside skill', 'utf-8')
    await fs.rm(skillFilePath, { force: true })
    await fs.symlink(outsideSkill, skillFilePath)

    const handler = registerAndGetBundleViewerHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const result = await handler({}, {
      projectId: 'project-1',
      bundle: {
        skillFilePath,
        relativePath: 'scripts/run.sh',
      },
    })
    expectFailure(result, 'capability_path_denied', 'Access denied: path outside allowed capability directories')
  })

  it('bundle file listing skips symbolic links to avoid metadata leaks', async () => {
    const scriptsDir = path.join(path.dirname(skillFilePath), 'scripts')
    await fs.mkdir(scriptsDir, { recursive: true })
    await fs.writeFile(path.join(scriptsDir, 'run.sh'), 'echo run', 'utf-8')
    const outsideFile = path.join(tempRoot, 'outside.txt')
    await fs.writeFile(outsideFile, 'outside', 'utf-8')
    await fs.symlink(outsideFile, path.join(scriptsDir, 'linked.txt'))

    const handler = registerAndGetBundleListHandler({
      capabilityCenter: {
        resolveProjectPathFromId,
      } as unknown as IPCDeps['capabilityCenter'],
    })

    const files = await handler({}, skillFilePath, 'project-1') as Array<{ relativePath: string }>
    const relPaths = files.map((item) => item.relativePath)
    expect(relPaths).toContain('scripts/run.sh')
    expect(relPaths).not.toContain('scripts/linked.txt')
  })
})
