// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { RuleEntry } from '@shared/types'
import { safeDirEntries, safeReadFile, byName } from '../utils'
import path from 'node:path'
import { safeSlice } from '@shared/unicode'

export const ruleScanner: CapabilityScanner<'rule'> = {
  category: 'rule',
  async scan(ctx) {
    const { paths } = ctx
    const globalRules: RuleEntry[] = await scanRulesDir(paths.globalRules, 'global', 'user-rule')

    let projectRules: RuleEntry[] = []
    if (paths.project) {
      const dirRules = await scanRulesDir(paths.project.rules, 'project', 'project-rule')
      const claudeMdRule = await scanClaudeMd(paths.project.claudeMd)
      projectRules = [...dirRules, ...claudeMdRule]
    }

    return {
      global: globalRules.sort(byName),
      project: projectRules.sort(byName),
    }
  }
}

async function scanRulesDir(
  dirPath: string,
  scope: 'global' | 'project',
  ruleType: RuleEntry['ruleType']
): Promise<RuleEntry[]> {
  const entries = await safeDirEntries(dirPath)
  const rules: RuleEntry[] = []

  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith('.md')) continue
    const fullPath = path.join(dirPath, entry.name)
    const content = await safeReadFile(fullPath)
    const name = entry.name.replace('.md', '')

    rules.push({
      name,
      description: content ? safeSlice(content, 0, 100).replace(/\n/g, ' ').trim() : '',
      source: {
        scope,
        origin: scope === 'project' ? 'project' : 'user',
        sourcePath: fullPath,
      },
      ruleType,
    })
  }
  return rules
}

async function scanClaudeMd(claudeMdPath: string): Promise<RuleEntry[]> {
  const content = await safeReadFile(claudeMdPath)
  if (!content) return []

  return [{
    name: 'CLAUDE.md',
    description: content.slice(0, 100).replace(/\n/g, ' ').trim(),
    source: {
      scope: 'project',
      origin: 'project',
      sourcePath: claudeMdPath,
    },
    ruleType: 'claude-md',
  }]
}
