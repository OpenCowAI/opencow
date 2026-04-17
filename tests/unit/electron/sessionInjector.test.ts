// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import type { CapabilitySnapshot, ConfigCapabilityEntry, DocumentCapabilityEntry } from '../../../src/shared/types'
import type { StateRepository, DistributionRecord } from '../../../electron/services/capabilityCenter/stateRepository'
import {
  buildCapabilityPlan,
  type CapabilityPlanRequest,
} from '../../../electron/services/capabilityCenter/sessionInjector'

function createSkill(params: {
  name: string
  scope: 'global' | 'project'
  body?: string
  description?: string
  attributes?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name: params.name,
    description: params.description ?? '',
    body: params.body ?? 'Do useful work.',
    attributes: params.attributes ?? {},
    filePath: `/tmp/${params.name}.md`,
    category: 'skill',
    scope: params.scope,
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: params.metadata ?? {},
    importInfo: null,
    distributionInfo: null,
    mountInfo: null,
  }
}

function createSnapshot(skill: DocumentCapabilityEntry): CapabilitySnapshot {
  return {
    skills: [skill],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    diagnostics: [],
    version: Date.now(),
    timestamp: Date.now(),
  }
}

function createDistribution(targetType: string, name: string): DistributionRecord {
  return {
    category: 'skill',
    name,
    targetType,
    targetPath: `/tmp/${name}.md`,
    strategy: 'copy',
    contentHash: 'sha256:test',
    distributedAt: Date.now(),
  }
}

function createRequest(params: {
  explicitSkillNames?: string[]
  implicitQuery?: string
  maxSkillChars?: number
} = {}): CapabilityPlanRequest {
  return {
    session: {},
    activation: {
      explicitSkillNames: params.explicitSkillNames,
      implicitQuery: params.implicitQuery,
    },
    policy: {
      maxSkillChars: params.maxSkillChars,
    },
  }
}

function createMcpServer(params: {
  name: string
  config: Record<string, unknown>
}): ConfigCapabilityEntry {
  return {
    kind: 'config',
    name: params.name,
    description: '',
    config: params.config,
    filePath: `/tmp/${params.name}.json`,
    category: 'mcp-server',
    scope: 'global',
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: {},
    importInfo: null,
    distributionInfo: null,
    mountInfo: null,
  }
}

function createSnapshotWithMcpServers(mcpServers: ConfigCapabilityEntry[]): CapabilitySnapshot {
  return {
    skills: [],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers,
    diagnostics: [],
    version: Date.now(),
    timestamp: Date.now(),
  }
}

describe('buildCapabilityPlan MCP server config validation', () => {
  const batchGetDistributions = vi.fn(async () => new Map())
  const stateRepo = { batchGetDistributions } as unknown as StateRepository
  const baseRequest = createRequest()

  it('includes valid stdio MCP server configs', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'my-stdio-server',
        config: { name: 'my-stdio-server', serverConfig: { type: 'stdio', command: 'npx', args: ['-y', 'my-mcp'] } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('my-stdio-server')
    expect(plan.mcpServers['my-stdio-server']).toMatchObject({ type: 'stdio', command: 'npx' })
  })

  it('includes valid stdio MCP server without explicit type', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'implicit-stdio',
        config: { name: 'implicit-stdio', serverConfig: { command: 'node', args: ['server.js'] } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('implicit-stdio')
  })

  it('includes valid SSE MCP server configs', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'deepwiki',
        config: { name: 'deepwiki', serverConfig: { type: 'sse', url: 'https://mcp.deepwiki.com/sse' } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('deepwiki')
    expect(plan.mcpServers['deepwiki']).toMatchObject({ type: 'sse', url: 'https://mcp.deepwiki.com/sse' })
  })

  it('includes valid HTTP MCP server configs', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'exa',
        config: { name: 'exa', serverConfig: { type: 'http', url: 'https://mcp.exa.ai/', headers: { 'x-api-key': 'test' } } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('exa')
    expect(plan.mcpServers['exa']).toMatchObject({ type: 'http', url: 'https://mcp.exa.ai/' })
  })

  it('skips MCP server with empty command for stdio type', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'broken-stdio',
        config: { name: 'broken-stdio', serverConfig: { type: 'stdio', command: '' } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).not.toHaveProperty('broken-stdio')
  })

  it('skips SSE MCP server missing url field', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'broken-sse',
        config: { name: 'broken-sse', serverConfig: { type: 'sse', command: '' } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).not.toHaveProperty('broken-sse')
  })

  it('skips MCP server with unknown type', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'bad-type',
        config: { name: 'bad-type', serverConfig: { type: 'unknown-type', foo: 'bar' } },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).not.toHaveProperty('bad-type')
  })

  it('skips MCP server whose config is not a plain object', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'non-object',
        config: { name: 'non-object', serverConfig: 'not-an-object' } as unknown as Record<string, unknown>,
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).not.toHaveProperty('non-object')
  })

  it('falls back to mcp.config when serverConfig key is missing', async () => {
    // Legacy format without serverConfig wrapper — the config itself IS the server config
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'legacy-server',
        config: { command: 'npx', args: ['-y', 'some-server'] },
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('legacy-server')
  })

  it('valid configs pass while invalid ones are skipped in the same snapshot', async () => {
    const snapshot = createSnapshotWithMcpServers([
      createMcpServer({
        name: 'good-server',
        config: { name: 'good-server', serverConfig: { type: 'stdio', command: 'npx', args: ['good-mcp'] } },
      }),
      createMcpServer({
        name: 'bad-server',
        config: { name: 'bad-server', serverConfig: { type: 'sse' } }, // missing url
      }),
    ])

    const plan = await buildCapabilityPlan({ snapshot, stateRepo, request: baseRequest })
    expect(plan.mcpServers).toHaveProperty('good-server')
    expect(plan.mcpServers).not.toHaveProperty('bad-server')
    expect(plan.summary.mcpServers).toContain('good-server')
  })
})
