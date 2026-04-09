// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { HtmlNativeCapability } from '../../../electron/nativeCapabilities/htmlNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

// Phase 1B.11: tests now build the SDK CapabilityToolContext shape
// (sessionContext + hostEnvironment) and call descriptor.execute with the
// SDK signature (args + sessionContext + toolUseId + abortSignal).

function makeRelay(): ToolProgressRelay {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  } as unknown as ToolProgressRelay
}

function makeSessionContext(): OpenCowSessionContext {
  return {
    sessionId: 'session-html-capability-1',
    cwd: '/tmp',
    abortSignal: new AbortController().signal,
    projectId: null,
    issueId: null,
    originSource: 'agent',
    relay: makeRelay(),
  }
}

function makeContext(sessionContext = makeSessionContext()): NativeCapabilityToolContext {
  return {
    sessionContext,
    hostEnvironment: { activeMcpServerNames: [] },
  }
}

describe('HtmlNativeCapability', () => {
  it('returns an error when content is missing', async () => {
    const capability = new HtmlNativeCapability()
    const ctx = makeContext()
    const tool = capability.getToolDescriptors(ctx)[0]!

    const result = await tool.execute({
      args: { title: 'AI Agent' },
      sessionContext: ctx.sessionContext,
      toolUseId: 'test-tool-use-1',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect((result.content as Array<{ type: string; text: string }>)[0]?.type).toBe('text')
    expect((result.content as Array<{ type: string; text: string }>)[0]?.text).toContain('requires non-empty HTML content')
  })

  it('accepts legacy html alias and succeeds', async () => {
    const capability = new HtmlNativeCapability()
    const ctx = makeContext()
    const tool = capability.getToolDescriptors(ctx)[0]!

    const result = await tool.execute({
      args: {
        title: 'AI Agent',
        html: '<!doctype html><html><body><h1>AI Agent</h1></body></html>',
      },
      sessionContext: ctx.sessionContext,
      toolUseId: 'test-tool-use-2',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).not.toBe(true)
    expect((result.content as Array<{ type: string; text: string }>)[0]?.type).toBe('text')
    expect((result.content as Array<{ type: string; text: string }>)[0]?.text).toContain('HTML page "AI Agent" generated')
  })
})
