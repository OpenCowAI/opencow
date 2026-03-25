// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Dual-engine governance drift sync', () => {
  let tempDir: string
  let sourceProjectPath: string
  let targetProjectPath: string
  let store: CapabilityStore
  let distributions: Array<{
    category: string
    name: string
    targetType: string
    targetPath: string
    strategy: 'copy' | 'symlink'
    contentHash: string
    distributedAt: number
  }>
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
    const rawTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencow-dual-engine-'))
    tempDir = await fs.realpath(rawTempDir)
    sourceProjectPath = path.join(tempDir, 'source-project')
    targetProjectPath = path.join(tempDir, 'target-project')
    await fs.mkdir(sourceProjectPath, { recursive: true })
    await fs.mkdir(targetProjectPath, { recursive: true })

    store = new CapabilityStore({
      globalRoot: path.join(tempDir, 'capabilities'),
    })

    distributions = []
    stateRepo = {
      recordImport: vi.fn(async () => {}),
      recordDistribution: vi.fn(async (record) => {
        const idx = distributions.findIndex((d) =>
          d.category === record.category
          && d.name === record.name
          && d.targetType === record.targetType,
        )
        if (idx >= 0) {
          distributions[idx] = { ...record }
        } else {
          distributions.push({ ...record })
        }
      }),
      removeDistribution: vi.fn(async (category, name, targetType) => {
        distributions = distributions.filter((d) =>
          !(d.category === category && d.name === name && d.targetType === targetType),
        )
      }),
      getAllDistributions: vi.fn(async () => distributions.map((d) => ({ ...d }))),
      getDistributionsFor: vi.fn(async (category, name) =>
        distributions.filter((d) => d.category === category && d.name === name).map((d) => ({ ...d })),
      ),
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

  it('supports drift detect/sync per engine in a dual-engine project', async () => {
    const claudeSkillPath = path.join(sourceProjectPath, '.claude', 'skills', 'claude_skill', 'SKILL.md')
    await fs.mkdir(path.dirname(claudeSkillPath), { recursive: true })
    await fs.writeFile(claudeSkillPath, '# claude skill\n', 'utf-8')

    const codexSkillPath = path.join(sourceProjectPath, '.agents', 'skills', 'codex_skill', 'SKILL.md')
    await fs.mkdir(path.dirname(codexSkillPath), { recursive: true })
    await fs.writeFile(codexSkillPath, '# codex skill\n', 'utf-8')

    const claudeDiscovered = (await importPipeline.discoverImportable('claude-code', sourceProjectPath))
      .filter((i) => i.sourceScope === 'project' && i.category === 'skill')
    const codexDiscovered = (await importPipeline.discoverImportable('codex', sourceProjectPath))
      .filter((i) => i.sourceScope === 'project' && i.category === 'skill')

    expect(claudeDiscovered.map((i) => i.name)).toContain('claude_skill')
    expect(codexDiscovered.map((i) => i.name)).toContain('codex_skill')

    const importResult = await importPipeline.importItems(
      [...claudeDiscovered, ...codexDiscovered],
      { scope: 'global' },
    )
    expect(importResult.errors).toEqual([])

    await distributionPipeline.publish({
      category: 'skill',
      name: 'claude_skill',
      target: { type: 'claude-code-project', projectPath: targetProjectPath },
    })
    await distributionPipeline.publish({
      category: 'skill',
      name: 'codex_skill',
      target: { type: 'codex-project', projectPath: targetProjectPath },
    })

    const storedClaude = await store.resolveActualPath('global', 'skill', 'claude_skill')
    const storedCodex = await store.resolveActualPath('global', 'skill', 'codex_skill')
    expect(storedClaude).toBeTruthy()
    expect(storedCodex).toBeTruthy()

    await fs.writeFile(storedClaude!, '# claude skill changed\n', 'utf-8')
    await fs.writeFile(storedCodex!, '# codex skill changed\n', 'utf-8')

    const allDrifts = await distributionPipeline.detectDrift()
    expect(allDrifts.map((d) => d.targetType).sort()).toEqual(['claude-code-project', 'codex-project'])

    const codexDrifts = await distributionPipeline.detectDrift({ engineKind: 'codex' })
    expect(codexDrifts).toHaveLength(1)
    expect(codexDrifts[0]?.targetType).toBe('codex-project')

    const syncCodex = await distributionPipeline.syncAll({ engineKind: 'codex' })
    expect(syncCodex.errors).toEqual([])
    expect(syncCodex.synced).toHaveLength(1)

    const codexDriftsAfter = await distributionPipeline.detectDrift({ engineKind: 'codex' })
    expect(codexDriftsAfter).toHaveLength(0)

    const claudeDriftsAfterCodexSync = await distributionPipeline.detectDrift({ engineKind: 'claude' })
    expect(claudeDriftsAfterCodexSync).toHaveLength(1)

    const syncClaude = await distributionPipeline.syncAll({ engineKind: 'claude' })
    expect(syncClaude.errors).toEqual([])
    expect(syncClaude.synced).toHaveLength(1)

    const claudeDriftsAfter = await distributionPipeline.detectDrift({ engineKind: 'claude' })
    expect(claudeDriftsAfter).toHaveLength(0)
  })
})
