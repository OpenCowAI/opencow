// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DistributionPipeline } from '../../../electron/services/capabilityCenter/distributionPipeline'
import { parseTomlConfig } from '../../../electron/services/capabilityCenter/governance/tomlPatch'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getName: () => 'OpenCow',
  },
}))

describe('DistributionPipeline (codex)', () => {
  let tempDir: string
  let sourceDir: string
  let store: {
    resolvePath: ReturnType<typeof vi.fn>
    resolveActualPath: ReturnType<typeof vi.fn>
  }
  let stateRepo: {
    recordDistribution: ReturnType<typeof vi.fn>
    removeDistribution: ReturnType<typeof vi.fn>
    getAllDistributions: ReturnType<typeof vi.fn>
    getDistributionsFor: ReturnType<typeof vi.fn>
  }
  let pipeline: DistributionPipeline

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-codex-dist-'))
    sourceDir = path.join(tempDir, 'source')
    await fs.mkdir(sourceDir, { recursive: true })

    store = {
      resolvePath: vi.fn(),
      resolveActualPath: vi.fn(),
    }
    stateRepo = {
      recordDistribution: vi.fn(async () => {}),
      removeDistribution: vi.fn(async () => {}),
      getAllDistributions: vi.fn(async () => []),
      getDistributionsFor: vi.fn(async () => []),
    }

    pipeline = new DistributionPipeline(store as unknown as any, stateRepo as unknown as any)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('publishes codex mcp-server into .codex/config.toml with opencow marker', async () => {
    const sourcePath = path.join(sourceDir, 'alpha.json')
    await fs.writeFile(sourcePath, JSON.stringify({
      name: 'alpha',
      serverConfig: {
        command: 'node',
        args: ['server.js'],
      },
    }, null, 2), 'utf-8')

    store.resolvePath.mockReturnValue(sourcePath)

    await pipeline.publish({
      category: 'mcp-server',
      name: 'alpha',
      target: { type: 'codex-project', projectPath: tempDir },
    })

    const configPath = path.join(tempDir, '.codex', 'config.toml')
    const configToml = await fs.readFile(configPath, 'utf-8')
    const parsed = parseTomlConfig(configToml)

    const mcpServers = parsed['mcp_servers'] as Record<string, unknown>
    expect((mcpServers.alpha as Record<string, unknown>)?.command).toBe('node')

    const opencow = parsed['opencow'] as Record<string, unknown>
    const managed = opencow['managed_mcp_servers'] as Record<string, unknown>
    expect(managed.alpha).toBe('opencow:alpha')

    expect(stateRepo.recordDistribution).toHaveBeenCalledWith(expect.objectContaining({
      category: 'mcp-server',
      name: 'alpha',
      targetType: 'codex-project',
      targetPath: configPath,
    }))
  })

  it('fails publish when codex mcp server name already exists and is unmanaged', async () => {
    const sourcePath = path.join(sourceDir, 'alpha.json')
    await fs.writeFile(sourcePath, JSON.stringify({
      name: 'alpha',
      serverConfig: {
        command: 'node',
      },
    }, null, 2), 'utf-8')

    const configPath = path.join(tempDir, '.codex', 'config.toml')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, '[mcp_servers.alpha]\ncommand = "python"\n', 'utf-8')

    store.resolvePath.mockReturnValue(sourcePath)

    await expect(
      pipeline.publish({
        category: 'mcp-server',
        name: 'alpha',
        target: { type: 'codex-project', projectPath: tempDir },
      }),
    ).rejects.toThrow(/not managed by OpenCow/)

    expect(stateRepo.recordDistribution).not.toHaveBeenCalled()
  })

  it('unpublishes codex mcp-server by removing only managed entries', async () => {
    const configPath = path.join(tempDir, '.codex', 'config.toml')
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(
      configPath,
      [
        '[mcp_servers.alpha]',
        'command = "node"',
        '',
        '[mcp_servers.beta]',
        'command = "python"',
        '',
        '[opencow.managed_mcp_servers]',
        'alpha = "opencow:alpha"',
        '',
      ].join('\n'),
      'utf-8',
    )

    await pipeline.unpublish({
      category: 'mcp-server',
      name: 'alpha',
      target: { type: 'codex-project', projectPath: tempDir },
    })

    const parsed = parseTomlConfig(await fs.readFile(configPath, 'utf-8'))
    const mcpServers = parsed['mcp_servers'] as Record<string, unknown>
    expect(mcpServers.alpha).toBeUndefined()
    expect((mcpServers.beta as Record<string, unknown>)?.command).toBe('python')

    expect(stateRepo.removeDistribution).toHaveBeenCalledWith('mcp-server', 'alpha', 'codex-project')
  })

  it('publishes skill to codex project .agents/skills path', async () => {
    const skillDir = path.join(sourceDir, 'my-skill')
    const skillMd = path.join(skillDir, 'SKILL.md')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(skillMd, '# my skill\n', 'utf-8')
    await fs.writeFile(path.join(skillDir, 'helper.txt'), 'asset\n', 'utf-8')

    store.resolveActualPath.mockResolvedValue(skillMd)

    await pipeline.publish({
      category: 'skill',
      name: 'my-skill',
      target: { type: 'codex-project', projectPath: tempDir },
      strategy: 'copy',
    })

    const targetSkillMd = path.join(tempDir, '.agents', 'skills', 'my-skill', 'SKILL.md')
    const targetAsset = path.join(tempDir, '.agents', 'skills', 'my-skill', 'helper.txt')

    expect(await fs.readFile(targetSkillMd, 'utf-8')).toContain('# my skill')
    expect(await fs.readFile(targetAsset, 'utf-8')).toContain('asset')
  })

  it('returns explicit unsupported error for codex hook publish', async () => {
    await expect(
      pipeline.publish({
        category: 'hook',
        name: 'hook-a',
        target: { type: 'codex-project', projectPath: tempDir },
      }),
    ).rejects.toThrow('codex does not support category=hook')
  })

  it('detects drift with engine filter', async () => {
    const codexSourcePath = path.join(sourceDir, 'codex-skill.md')
    const claudeSourcePath = path.join(sourceDir, 'claude-skill.md')
    await fs.writeFile(codexSourcePath, 'codex-content', 'utf-8')
    await fs.writeFile(claudeSourcePath, 'claude-content', 'utf-8')

    store.resolveActualPath.mockImplementation(async (_scope, _category, name) => {
      if (name === 'codex-skill') return codexSourcePath
      if (name === 'claude-skill') return claudeSourcePath
      return null
    })

    stateRepo.getAllDistributions.mockResolvedValue([
      {
        category: 'skill',
        name: 'codex-skill',
        targetType: 'codex-global',
        targetPath: '/tmp/.codex/config.toml',
        strategy: 'copy',
        contentHash: 'sha256:stale-codex',
        distributedAt: Date.now(),
      },
      {
        category: 'skill',
        name: 'claude-skill',
        targetType: 'claude-code-global',
        targetPath: '/tmp/.claude/skills/claude-skill/SKILL.md',
        strategy: 'copy',
        contentHash: 'sha256:stale-claude',
        distributedAt: Date.now(),
      },
    ])

    const codexDrifts = await pipeline.detectDrift({ engineKind: 'codex' })
    expect(codexDrifts).toHaveLength(1)
    expect(codexDrifts[0]?.targetType).toBe('codex-global')

    const claudeDrifts = await pipeline.detectDrift({ engineKind: 'claude' })
    expect(claudeDrifts).toHaveLength(1)
    expect(claudeDrifts[0]?.targetType).toBe('claude-code-global')
  })
})
