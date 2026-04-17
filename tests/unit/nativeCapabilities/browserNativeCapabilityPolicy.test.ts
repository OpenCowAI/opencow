// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

const { mockGetMainWindow } = vi.hoisted(() => ({
  mockGetMainWindow: vi.fn(() => ({}) as never),
}))

vi.mock('../../../electron/window/windowManager', () => ({
  getMainWindow: mockGetMainWindow,
}))

import { BrowserNativeCapability } from '../../../electron/nativeCapabilities/browser/browserNativeCapability'

function makeRelay(): ToolProgressRelay {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  } as unknown as ToolProgressRelay
}

function makeSessionContext(params: {
  projectId: string | null
  issueId?: string | null
  projectPath?: string | undefined
  startupCwd?: string
}): OpenCowSessionContext {
  return {
    sessionId: 'session-1',
    cwd: params.startupCwd ?? params.projectPath ?? '/tmp',
    abortSignal: new AbortController().signal,
    projectId: params.projectId,
    issueId: params.issueId ?? null,
    originSource: 'agent',
    ...(params.projectPath !== undefined ? { projectPath: params.projectPath } : {}),
    ...(params.startupCwd !== undefined ? { startupCwd: params.startupCwd } : {}),
    relay: makeRelay(),
  }
}

function makeContext(params: {
  projectId: string | null
  issueId?: string | null
  projectPath?: string | undefined
  startupCwd?: string
}): NativeCapabilityToolContext {
  return {
    sessionContext: makeSessionContext(params),
    hostEnvironment: { activeMcpServerNames: [] },
  }
}

/**
 * Phase 1B.11 helper: invoke a descriptor's execute with the new SDK shape.
 */
async function executeTool(
  ctx: NativeCapabilityToolContext,
  tool: { execute: (input: never) => Promise<unknown> },
  args: Record<string, unknown>,
) {
  return (tool.execute as (input: {
    args: Record<string, unknown>
    sessionContext: OpenCowSessionContext
    toolUseId: string
    abortSignal: AbortSignal
  }) => Promise<unknown>)({
    args,
    sessionContext: ctx.sessionContext,
    toolUseId: 'browser-policy-test',
    abortSignal: new AbortController().signal,
  })
}

describe('BrowserNativeCapability default policy', () => {
  const resolveStateBinding = vi.fn()
  const getOrCreateSessionView = vi.fn().mockResolvedValue('view-1')
  const executeCommand = vi.fn().mockResolvedValue({ status: 'success', data: null })
  const getPageInfo = vi.fn().mockReturnValue({ url: 'https://example.com', title: 'Example', isLoading: false })

  const busDispatch = vi.fn()

  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    resolveStateBinding.mockResolvedValue({
      policy: 'shared-global',
      profileId: 'profile-1',
      reason: 'policy:shared-global:global',
      sourceType: 'chat-session',
      projectId: null,
      issueId: null,
      sessionId: 'session-1',
    })
  })

  it('uses shared-global when session has no project (Home Chat)', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
    })

    const ctx = makeContext({ projectId: null })
    const tools = capability.getToolDescriptors(ctx)
    const navigateTool = tools.find((t) => t.name === 'browser_navigate')
    expect(navigateTool).toBeTruthy()
    await executeTool(ctx, navigateTool!, { url: 'https://example.com' })

    expect(resolveStateBinding).toHaveBeenCalledWith({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'shared-global',
      sessionId: 'session-1',
      issueId: undefined,
      projectId: undefined,
    })
  })

  it('uses project-configured shared-project policy', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
      resolveProjectBrowserStatePolicy: vi.fn().mockResolvedValue('shared-project'),
    })

    const ctx = makeContext({ projectId: 'project-1' })
    const tools = capability.getToolDescriptors(ctx)
    const navigateTool = tools.find((t) => t.name === 'browser_navigate')
    expect(navigateTool).toBeTruthy()
    await executeTool(ctx, navigateTool!, { url: 'https://example.com' })

    expect(resolveStateBinding).toHaveBeenCalledWith({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'shared-project',
      sessionId: 'session-1',
      issueId: undefined,
      projectId: 'project-1',
    })
  })

  it('uses project-configured isolated-session policy', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
      resolveProjectBrowserStatePolicy: vi.fn().mockResolvedValue('isolated-session'),
    })

    const ctx = makeContext({ projectId: 'project-1' })
    const tools = capability.getToolDescriptors(ctx)
    const navigateTool = tools.find((t) => t.name === 'browser_navigate')
    expect(navigateTool).toBeTruthy()
    await executeTool(ctx, navigateTool!, { url: 'https://example.com' })

    expect(resolveStateBinding).toHaveBeenCalledWith({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'isolated-session',
      sessionId: 'session-1',
      issueId: undefined,
      projectId: 'project-1',
    })
  })

  it('uses isolated-issue policy with issue session source when issue context exists', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
      resolveProjectBrowserStatePolicy: vi.fn().mockResolvedValue('isolated-issue'),
    })

    const ctx = makeContext({ projectId: 'project-1', issueId: 'issue-1' })
    const tools = capability.getToolDescriptors(ctx)
    const navigateTool = tools.find((t) => t.name === 'browser_navigate')
    expect(navigateTool).toBeTruthy()
    await executeTool(ctx, navigateTool!, { url: 'https://example.com' })

    expect(resolveStateBinding).toHaveBeenCalledWith({
      source: { type: 'issue-session', issueId: 'issue-1', sessionId: 'session-1' },
      policy: 'isolated-issue',
      sessionId: 'session-1',
      issueId: 'issue-1',
      projectId: 'project-1',
    })
  })

  it('falls back to isolated-session when configured isolated-issue but issue context is missing', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
      resolveProjectBrowserStatePolicy: vi.fn().mockResolvedValue('isolated-issue'),
    })

    const ctx = makeContext({ projectId: 'project-1' })
    const tools = capability.getToolDescriptors(ctx)
    const navigateTool = tools.find((t) => t.name === 'browser_navigate')
    expect(navigateTool).toBeTruthy()
    await executeTool(ctx, navigateTool!, { url: 'https://example.com' })

    expect(resolveStateBinding).toHaveBeenCalledWith({
      source: { type: 'chat-session', sessionId: 'session-1' },
      policy: 'isolated-session',
      sessionId: 'session-1',
      issueId: undefined,
      projectId: 'project-1',
    })
  })

  it('injects session projectPath/startupCwd into browser_upload execution context', async () => {
    const capability = new BrowserNativeCapability({
      browserService: {
        resolveStateBinding,
        getOrCreateSessionView,
        executeCommand,
        getPageInfo,
      } as never,
      bus: { dispatch: busDispatch } as never,
    })

    const ctx = makeContext({
      projectId: 'project-1',
      projectPath: '/workspace/project-1',
      startupCwd: '/workspace/project-1/packages/app',
    })
    const tools = capability.getToolDescriptors(ctx)
    const uploadTool = tools.find((t) => t.name === 'browser_upload')
    expect(uploadTool).toBeTruthy()
    expect(uploadTool!.name).toBe('browser_upload')

    await executeTool(ctx, uploadTool!, {
      target: { kind: 'css', selector: '#file' },
      files: ['fixtures/avatar.png'],
    })

    expect(resolveStateBinding).toHaveBeenCalledTimes(1)
    expect(getOrCreateSessionView).toHaveBeenCalledTimes(1)
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload',
        target: { kind: 'css', selector: '#file' },
        files: ['fixtures/avatar.png'],
      }),
      expect.objectContaining({
        projectPath: '/workspace/project-1',
        startupCwd: '/workspace/project-1/packages/app',
      }),
    )
  })
})
