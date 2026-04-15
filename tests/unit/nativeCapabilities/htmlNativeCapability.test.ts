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

type TextContent = Array<{ type: string; text: string }>

describe('HtmlNativeCapability', () => {
  it('returns an error when html is missing', async () => {
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
    expect((result.content as TextContent)[0]?.text).toContain('non-empty HTML markup in the "html" field')
  })

  it('accepts a valid html payload and succeeds', async () => {
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
    expect((result.content as TextContent)[0]?.text).toContain('HTML page "AI Agent" generated')
  })

  it('rejects an html field that contains no HTML tags (defense against models that smuggle a description)', async () => {
    // Bug repro from session ccb-5daD6389nAMh: GPT-5.4 misread the schema's
    // legacy `content` field as "page description" and put HTML in `html`.
    // After dropping `content`, a confused model could still drop a textual
    // description directly into `html`. The execute-time guard catches that
    // and returns a precise error so the model self-corrects on the next turn.
    const capability = new HtmlNativeCapability()
    const ctx = makeContext()
    const tool = capability.getToolDescriptors(ctx)[0]!

    const result = await tool.execute({
      args: {
        title: 'AI Agent',
        html: 'A simple introduction to AI Agent — definition, capabilities, scenarios.',
      },
      sessionContext: ctx.sessionContext,
      toolUseId: 'test-tool-use-3',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect((result.content as TextContent)[0]?.text).toContain('must be raw HTML markup')
  })

  it('accepts a single top-level element (no <!doctype> required)', async () => {
    // Fragment HTML is valid input — models often skip the doctype boilerplate
    // for small artifacts. The guard must not over-reject these.
    const capability = new HtmlNativeCapability()
    const ctx = makeContext()
    const tool = capability.getToolDescriptors(ctx)[0]!

    const result = await tool.execute({
      args: {
        title: 'Fragment',
        html: '<div class="card"><h1>Hi</h1><p>body</p></div>',
      },
      sessionContext: ctx.sessionContext,
      toolUseId: 'test-tool-use-4',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).not.toBe(true)
  })

  it('ignores any stray `content` field — it is no longer part of the schema', async () => {
    // The legacy `content` alias was removed because its semantically loaded
    // name caused field-attribution bugs. Even if a model invents the field
    // again at runtime, the tool now only ever reads `html`.
    const capability = new HtmlNativeCapability()
    const ctx = makeContext()
    const tool = capability.getToolDescriptors(ctx)[0]!

    const result = await tool.execute({
      // Cast through `unknown` so the runtime test can carry a field the
      // typed schema deliberately rejects at compile time.
      args: {
        title: 'AI Agent',
        html: '<html><body><h1>real</h1></body></html>',
        content: 'A textual description some models would smuggle in.',
      } as unknown as { title: string; html: string },
      sessionContext: ctx.sessionContext,
      toolUseId: 'test-tool-use-5',
      abortSignal: new AbortController().signal,
    })

    expect(result.isError).not.toBe(true)
    expect((result.content as TextContent)[0]?.text).toContain('HTML page "AI Agent" generated')
  })
})
