// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { HtmlNativeCapability } from '../../../electron/nativeCapabilities/htmlNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'

function makeContext(): NativeCapabilityToolContext {
  return {
    session: { sessionId: 'session-html-capability-1', projectId: null, originSource: 'agent' },
    relay: {
      register: vi.fn(),
      unregister: vi.fn(),
      emit: vi.fn(),
      flush: vi.fn(),
    } as unknown as NativeCapabilityToolContext['relay'],
  }
}

describe('HtmlNativeCapability', () => {
  it('returns an error when content is missing', async () => {
    const capability = new HtmlNativeCapability()
    const tool = capability.getToolDescriptors(makeContext())[0]

    const result = await tool.execute({
      args: { title: 'AI Agent' },
      context: {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1000,
      },
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text).toContain('requires non-empty HTML content')
  })

  it('accepts legacy html alias and succeeds', async () => {
    const capability = new HtmlNativeCapability()
    const tool = capability.getToolDescriptors(makeContext())[0]

    const result = await tool.execute({
      args: {
        title: 'AI Agent',
        html: '<!doctype html><html><body><h1>AI Agent</h1></body></html>',
      },
      context: {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 1000,
      },
    })

    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text).toContain('HTML page "AI Agent" generated')
  })
})

