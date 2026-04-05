// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { NativeCapabilityRegistry } from '../../../electron/nativeCapabilities/registry'
import type {
  NativeCapability,
  NativeCapabilityCategory,
  NativeCapabilityToolContext,
} from '../../../electron/nativeCapabilities/types'

function makeContext(): NativeCapabilityToolContext {
  return {
    session: { sessionId: 'session-registry-1', projectId: null, issueId: null, originSource: 'agent' },
    relay: {
      register: vi.fn(),
      unregister: vi.fn(),
      emit: vi.fn(),
      flush: vi.fn(),
    } as unknown as NativeCapabilityToolContext['relay'],
  }
}

function makeCapability(category: NativeCapabilityCategory, toolName: string): NativeCapability {
  return {
    meta: {
      category,
      name: category,
      description: `${category} capability`,
      version: '1.0.0',
    },
    getToolDescriptors: () => [
      {
        name: toolName,
        description: `${toolName} tool`,
        inputSchema: {},
        execute: async () => ({
          content: [{ type: 'text', text: `${toolName}:ok` }],
        }),
      },
    ],
  }
}

function makeCapabilityWithTools(category: NativeCapabilityCategory, toolNames: string[]): NativeCapability {
  return {
    meta: {
      category,
      name: category,
      description: `${category} capability`,
      version: '1.0.0',
    },
    getToolDescriptors: () =>
      toolNames.map((toolName) => ({
        name: toolName,
        description: `${toolName} tool`,
        inputSchema: {},
        execute: async () => ({
          content: [{ type: 'text', text: `${toolName}:ok` }],
        }),
      })),
  }
}

describe('NativeCapabilityRegistry duplicate tool detection', () => {
  it('throws when duplicate tool names are collected from multiple capabilities', () => {
    const registry = new NativeCapabilityRegistry()
    registry.register(makeCapability('browser', 'dup_tool'))
    registry.register(makeCapability('issues', 'dup_tool'))

    expect(() =>
      registry.getToolDescriptorsByAllowlist(
        [
          { capability: 'browser' },
          { capability: 'issues' },
        ],
        makeContext(),
      ),
    ).toThrowError(/Duplicate native tool names are not allowed: dup_tool/)
  })

  it('filters tools by structured allowlist capability + tool', () => {
    const registry = new NativeCapabilityRegistry()
    registry.register(makeCapabilityWithTools('browser', ['browser_navigate', 'browser_click']))
    registry.register(makeCapabilityWithTools('issues', ['list_issues', 'create_issue']))

    const tools = registry.getToolDescriptorsByAllowlist(
      [
        { capability: 'browser' },
        { capability: 'issues', tool: 'create_issue' },
      ],
      makeContext(),
    )

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'browser_click',
      'browser_navigate',
      'create_issue',
    ])
  })
})
