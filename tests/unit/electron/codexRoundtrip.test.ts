// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityStore } from '../../../electron/services/capabilityCenter/capabilityStore'
import { ImportPipeline } from '../../../electron/services/capabilityCenter/importPipeline'
import { DistributionPipeline } from '../../../electron/services/capabilityCenter/distributionPipeline'
import { DiagnosticsCollector } from '../../../electron/services/capabilityCenter/diagnostics'
import { parseTomlConfig } from '../../../electron/services/capabilityCenter/governance/tomlPatch'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getName: () => 'OpenCow',
  },
}))

describe('Codex governance roundtrip (project source)', () => {
  let tempDir: string
  let sourceProjectPath: string
  let targetProjectPath: string
  let store: CapabilityStore
  let stateRepo: {
    recordImport: ReturnType<typeof vi.fn>
    recordDistribution: ReturnType<typeof vi.fn>
    removeDistribution: ReturnType<typeof vi.fn>
    getAllDistributions: ReturnType<typeof vi.fn>
    getDistributionsFor: ReturnType<typeof vi.fn>
  }
  let importPipeline: ImportPipeline
  let distributionPipeline: DistributionPipeline

  beforeEach(async () => {
    const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-codex-roundtrip-'))
    tempDir = await fs.realpath(rawTempDir)
    sourceProjectPath = path.join(tempDir, 'source-project')
    targetProjectPath = path.join(tempDir, 'target-project')
    await fs.mkdir(sourceProjectPath, { recursive: true })
    await fs.mkdir(targetProjectPath, { recursive: true })

    store = new CapabilityStore({
      globalRoot: path.join(tempDir, 'capabilities'),
    })

    stateRepo = {
      recordImport: vi.fn(async () => {}),
      recordDistribution: vi.fn(async () => {}),
      removeDistribution: vi.fn(async () => {}),
      getAllDistributions: vi.fn(async () => []),
      getDistributionsFor: vi.fn(async () => []),
    }

    importPipeline = new ImportPipeline(
      store,
      stateRepo as unknown as any,
      new DiagnosticsCollector(),
    )
    distributionPipeline = new DistributionPipeline(
      store,
      stateRepo as unknown as any,
    )
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('supports discover -> import -> publish -> unpublish for skill and mcp-server', async () => {
    // Source Codex project: one skill + one MCP server
    const sourceSkillPath = path.join(sourceProjectPath, '.agents', 'skills', 'alpha', 'SKILL.md')
    await fs.mkdir(path.dirname(sourceSkillPath), { recursive: true })
    await fs.writeFile(sourceSkillPath, '# alpha skill\n', 'utf-8')

    const sourceConfigPath = path.join(sourceProjectPath, '.codex', 'config.toml')
    await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true })
    await fs.writeFile(
      sourceConfigPath,
      [
        '[mcp_servers.demo_server]',
        'command = "node"',
        'args = ["server.js"]',
        '',
      ].join('\n'),
      'utf-8',
    )

    const discovered = await importPipeline.discoverImportable('codex', sourceProjectPath)
    const projectDiscovered = discovered.filter((i) => i.sourceScope === 'project')
    expect(projectDiscovered.map((i) => `${i.category}:${i.name}`).sort()).toEqual([
      'mcp-server:demo_server',
      'skill:alpha',
    ])

    const importResult = await importPipeline.importItems(projectDiscovered, { scope: 'global' })
    expect(importResult.errors).toEqual([])
    expect(importResult.imported.sort()).toEqual(['alpha', 'demo_server'])

    const storedSkillPath = await store.resolveActualPath('global', 'skill', 'alpha')
    expect(storedSkillPath).toBeTruthy()
    expect(await fs.readFile(storedSkillPath!, 'utf-8')).toContain('alpha skill')

    const storedMcpPath = store.resolvePath('global', 'mcp-server', 'demo_server')
    expect(await fs.readFile(storedMcpPath, 'utf-8')).toContain('"serverConfig"')

    await distributionPipeline.publish({
      category: 'skill',
      name: 'alpha',
      target: { type: 'codex-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.publish({
      category: 'mcp-server',
      name: 'demo_server',
      target: { type: 'codex-project', projectPath: targetProjectPath },
    })

    const targetSkillPath = path.join(targetProjectPath, '.agents', 'skills', 'alpha', 'SKILL.md')
    expect(await fs.readFile(targetSkillPath, 'utf-8')).toContain('alpha skill')

    const targetConfigPath = path.join(targetProjectPath, '.codex', 'config.toml')
    const parsed = parseTomlConfig(await fs.readFile(targetConfigPath, 'utf-8'))
    const mcpServers = parsed['mcp_servers'] as Record<string, unknown>
    expect((mcpServers.demo_server as Record<string, unknown>)?.command).toBe('node')

    await distributionPipeline.unpublish({
      category: 'skill',
      name: 'alpha',
      target: { type: 'codex-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.unpublish({
      category: 'mcp-server',
      name: 'demo_server',
      target: { type: 'codex-project', projectPath: targetProjectPath },
    })

    await expect(fs.access(path.join(targetProjectPath, '.agents', 'skills', 'alpha'))).rejects.toBeDefined()
    const parsedAfterUnpublish = parseTomlConfig(await fs.readFile(targetConfigPath, 'utf-8'))
    const mcpServersAfterUnpublish = parsedAfterUnpublish['mcp_servers'] as Record<string, unknown> | undefined
    expect(mcpServersAfterUnpublish?.demo_server).toBeUndefined()
  })
})
