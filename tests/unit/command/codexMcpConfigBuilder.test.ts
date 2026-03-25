// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { mergeCodexMcpServers } from '../../../electron/command/codexMcpConfigBuilder'

describe('mergeCodexMcpServers', () => {
  it('merges base config and overlays with later overlays taking precedence', () => {
    const merged = mergeCodexMcpServers({
      baseConfig: {
        approval_policy: 'never',
        mcp_servers: {
          docs: { command: 'node', args: ['base-docs.js'] },
          base_only: { command: 'node', args: ['base-only.js'] },
        },
      },
      overlays: [
        {
          docs: { command: 'node', args: ['capability-docs.js'] },
          cap_only: { command: 'node', args: ['capability-only.js'] },
        },
        {
          docs: { command: 'node', args: ['custom-docs.js'] },
          custom_only: { command: 'node', args: ['custom-only.js'] },
        },
      ],
    })

    expect(merged.config).toEqual({
      approval_policy: 'never',
      mcp_servers: {
        docs: { command: 'node', args: ['custom-docs.js'] },
        base_only: { command: 'node', args: ['base-only.js'] },
        cap_only: { command: 'node', args: ['capability-only.js'] },
        custom_only: { command: 'node', args: ['custom-only.js'] },
      },
    })
    expect([...merged.activeServerNames].sort()).toEqual(['base_only', 'cap_only', 'custom_only', 'docs'])
  })

  it('ignores non-object mcp server entries', () => {
    const merged = mergeCodexMcpServers({
      baseConfig: {
        mcp_servers: {
          valid: { command: 'node', args: ['ok.js'] },
          invalid: 'skip-me',
        },
      },
      overlays: [
        {
          alsoInvalid: null as unknown as Record<string, unknown>,
          valid2: { command: 'node', args: ['ok2.js'] },
        },
      ],
    })

    expect(merged.mcpServers).toEqual({
      valid: { command: 'node', args: ['ok.js'] },
      valid2: { command: 'node', args: ['ok2.js'] },
    })
  })

  it('preserves unrelated base config fields while normalizing only mcp_servers', () => {
    const onEvent = () => undefined
    const merged = mergeCodexMcpServers({
      baseConfig: {
        approval_policy: 'never',
        hooks: { onEvent },
        mcp_servers: {
          docs: { command: 'node', args: ['docs.js'] },
        },
      },
      overlays: [
        {
          docs: { command: 'node', args: ['docs-override.js'] },
        },
      ],
    })

    expect(merged.config).toEqual({
      approval_policy: 'never',
      hooks: { onEvent },
      mcp_servers: {
        docs: { command: 'node', args: ['docs-override.js'] },
      },
    })
  })
})
