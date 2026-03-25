// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { HOOK_MARKER_KEY } from '../../../src/shared/appIdentity'
import { CapabilityStore } from '../../../electron/services/capabilityCenter/capabilityStore'
import { ImportPipeline } from '../../../electron/services/capabilityCenter/importPipeline'
import { DistributionPipeline } from '../../../electron/services/capabilityCenter/distributionPipeline'
import { DiagnosticsCollector } from '../../../electron/services/capabilityCenter/diagnostics'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getName: () => 'OpenCow',
  },
}))

describe('Claude governance roundtrip (project source)', () => {
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
    const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-claude-roundtrip-'))
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

  it('supports discover -> import -> publish -> unpublish for skill, hook and mcp-server', async () => {
    const sourceSkillPath = path.join(sourceProjectPath, '.claude', 'skills', 'claude_skill', 'SKILL.md')
    await fs.mkdir(path.dirname(sourceSkillPath), { recursive: true })
    await fs.writeFile(sourceSkillPath, '# claude skill\n', 'utf-8')

    const sourceSettingsPath = path.join(sourceProjectPath, '.claude', 'settings.json')
    await fs.mkdir(path.dirname(sourceSettingsPath), { recursive: true })
    await fs.writeFile(
      sourceSettingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: '/tmp/deploy-guard.sh' },
              ],
            },
          ],
        },
      }, null, 2),
      'utf-8',
    )

    const sourceMcpPath = path.join(sourceProjectPath, '.mcp.json')
    await fs.writeFile(
      sourceMcpPath,
      JSON.stringify({
        mcpServers: {
          claude_demo: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
          },
        },
      }, null, 2),
      'utf-8',
    )

    const discovered = await importPipeline.discoverImportable('claude-code', sourceProjectPath)
    const projectDiscovered = discovered.filter((i) => i.sourceScope === 'project')
    expect(projectDiscovered.map((i) => `${i.category}:${i.name}`).sort()).toEqual([
      'hook:deploy-guard',
      'mcp-server:claude_demo',
      'skill:claude_skill',
    ])

    const importResult = await importPipeline.importItems(projectDiscovered, { scope: 'global' })
    expect(importResult.errors).toEqual([])
    expect(importResult.imported.sort()).toEqual(['claude_demo', 'claude_skill', 'deploy-guard'])

    await distributionPipeline.publish({
      category: 'skill',
      name: 'claude_skill',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.publish({
      category: 'hook',
      name: 'deploy-guard',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.publish({
      category: 'mcp-server',
      name: 'claude_demo',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })

    const targetSkillPath = path.join(targetProjectPath, '.claude', 'skills', 'claude_skill', 'SKILL.md')
    expect(await fs.readFile(targetSkillPath, 'utf-8')).toContain('claude skill')

    const targetSettingsPath = path.join(targetProjectPath, '.claude', 'settings.json')
    const targetSettings = JSON.parse(await fs.readFile(targetSettingsPath, 'utf-8')) as Record<string, any>
    const preToolUse = targetSettings.hooks?.PreToolUse as Array<Record<string, unknown>>
    expect(Array.isArray(preToolUse)).toBe(true)
    const managedHook = preToolUse.find((g) => g[HOOK_MARKER_KEY] === 'opencow:deploy-guard')
    expect(managedHook).toBeTruthy()

    const targetMcpPath = path.join(targetProjectPath, '.mcp.json')
    const targetMcp = JSON.parse(await fs.readFile(targetMcpPath, 'utf-8')) as Record<string, any>
    expect(targetMcp.mcpServers?.claude_demo?.command).toBe('node')

    await distributionPipeline.unpublish({
      category: 'skill',
      name: 'claude_skill',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.unpublish({
      category: 'hook',
      name: 'deploy-guard',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.unpublish({
      category: 'mcp-server',
      name: 'claude_demo',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })

    await expect(
      fs.access(path.join(targetProjectPath, '.claude', 'skills', 'claude_skill')),
    ).rejects.toBeDefined()

    const settingsAfterUnpublish = JSON.parse(await fs.readFile(targetSettingsPath, 'utf-8')) as Record<string, any>
    const preToolUseAfter = settingsAfterUnpublish.hooks?.PreToolUse as Array<Record<string, unknown>> | undefined
    const hasManagedAfter = (preToolUseAfter ?? []).some((g) => g[HOOK_MARKER_KEY] === 'opencow:deploy-guard')
    expect(hasManagedAfter).toBe(false)

    const mcpAfterUnpublish = JSON.parse(await fs.readFile(targetMcpPath, 'utf-8')) as Record<string, any>
    expect(mcpAfterUnpublish.mcpServers?.claude_demo).toBeUndefined()
  })
})
