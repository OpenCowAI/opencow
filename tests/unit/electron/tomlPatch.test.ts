// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  extractMcpServersFromToml,
  parseTomlConfig,
  removeManagedCodexMcpServer,
  upsertManagedCodexMcpServer,
} from '../../../electron/services/capabilityCenter/governance/tomlPatch'

describe('tomlPatch', () => {
  it('extracts mcp servers from codex config', () => {
    const content = `
[mcp_servers.alpha]
command = "node"
args = ["server.js"]

[mcp_servers.beta]
command = "uvx"
`

    const servers = extractMcpServersFromToml(content)
    expect(Object.keys(servers)).toEqual(['alpha', 'beta'])
    expect(servers.alpha?.command).toBe('node')
    expect(servers.beta?.command).toBe('uvx')
  })

  it('upserts managed mcp server with marker', () => {
    const content = upsertManagedCodexMcpServer({
      existingContent: '',
      name: 'alpha',
      serverConfig: {
        command: 'node',
        args: ['server.js'],
      },
    })

    const parsed = parseTomlConfig(content)
    const mcpServers = parsed['mcp_servers'] as Record<string, unknown>
    expect((mcpServers.alpha as Record<string, unknown>)?.command).toBe('node')

    const opencow = parsed['opencow'] as Record<string, unknown>
    const managed = opencow['managed_mcp_servers'] as Record<string, unknown>
    expect(managed.alpha).toBe('opencow:alpha')
  })

  it('throws when existing server is not opencow-managed', () => {
    const existing = `
[mcp_servers.alpha]
command = "python"
`

    expect(() => upsertManagedCodexMcpServer({
      existingContent: existing,
      name: 'alpha',
      serverConfig: { command: 'node' },
    })).toThrow(/not managed by OpenCow/)
  })

  it('removes only managed mcp server entries', () => {
    const existing = `
[mcp_servers.alpha]
command = "node"

[mcp_servers.beta]
command = "python"

[opencow.managed_mcp_servers]
alpha = "opencow:alpha"
`

    const result = removeManagedCodexMcpServer({ existingContent: existing, name: 'alpha' })
    expect(result.removed).toBe(true)

    const parsed = parseTomlConfig(result.content)
    const mcpServers = parsed['mcp_servers'] as Record<string, unknown>
    expect(mcpServers.alpha).toBeUndefined()
    expect((mcpServers.beta as Record<string, unknown>)?.command).toBe('python')
  })
})
