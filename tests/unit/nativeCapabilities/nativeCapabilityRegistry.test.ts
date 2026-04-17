// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  OpenCowCapabilityRegistry,
  type NativeCapabilityCategory,
} from '../../../electron/nativeCapabilities/openCowCapabilityRegistry'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { NativeCapability } from '../../../electron/nativeCapabilities/types'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

// Phase 1B.11: this test exercises OpenCow's thin wrapper
// (`OpenCowCapabilityRegistry.getDescriptorsForSession`) which preserves the
// historical NativeCapabilityRegistry semantics: per-tool filtering by
// allowlist, deduplication detection, and the same SDK CapabilityToolContext
// (sessionContext + hostEnvironment) shape that real capability providers
// consume in production.

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
    sessionId: 'session-registry-1',
    cwd: process.cwd(),
    abortSignal: new AbortController().signal,
    projectId: null,
    issueId: null,
    originSource: 'agent',
    startupCwd: process.cwd(),
    relay: makeRelay(),
  }
}

function makeCapability(
  category: NativeCapabilityCategory,
  toolName: string,
): NativeCapability {
  return {
    meta: {
      category,
      description: `${category} capability`,
    },
    getToolDescriptors: () => [
      {
        name: toolName,
        description: `${toolName} tool`,
        inputSchema: {},
        execute: async () => ({
          content: [{ type: 'text' as const, text: `${toolName}:ok` }],
        }),
      },
    ],
  }
}

function makeCapabilityWithTools(
  category: NativeCapabilityCategory,
  toolNames: string[],
): NativeCapability {
  return {
    meta: {
      category,
      description: `${category} capability`,
    },
    getToolDescriptors: () =>
      toolNames.map((toolName) => ({
        name: toolName,
        description: `${toolName} tool`,
        inputSchema: {},
        execute: async () => ({
          content: [{ type: 'text' as const, text: `${toolName}:ok` }],
        }),
      })),
  }
}

describe('OpenCowCapabilityRegistry duplicate tool detection', () => {
  it('throws when duplicate tool names are collected from multiple capabilities', () => {
    const registry = new OpenCowCapabilityRegistry()
    registry.register(makeCapability('browser', 'dup_tool'))
    registry.register(makeCapability('issues', 'dup_tool'))

    expect(() =>
      registry.getDescriptorsForSession({
        allowlist: [{ category: 'browser' }, { category: 'issues' }],
        sessionContext: makeSessionContext(),
        hostEnvironment: { activeMcpServerNames: [] },
      }),
    ).toThrowError(/Duplicate native tool names are not allowed: dup_tool/)
  })

  it('filters tools by structured allowlist capability + tool', () => {
    const registry = new OpenCowCapabilityRegistry()
    registry.register(makeCapabilityWithTools('browser', ['browser_navigate', 'browser_click']))
    registry.register(makeCapabilityWithTools('issues', ['list_issues', 'create_issue']))

    const tools = registry.getDescriptorsForSession({
      allowlist: [
        { category: 'browser' },
        { category: 'issues', tools: ['create_issue'] },
      ],
      sessionContext: makeSessionContext(),
      hostEnvironment: { activeMcpServerNames: [] },
    })

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'browser_click',
      'browser_navigate',
      'create_issue',
    ])
  })
})
