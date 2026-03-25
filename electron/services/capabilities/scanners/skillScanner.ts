// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { SkillEntry, CapabilityScope, CapabilitySource } from '@shared/types'
import type { ResolvedPlugin } from '../pluginResolver'
import { resolveCapabilityDirs } from '../pluginResolver'
import { safeDirEntries, safeReadFile, byName } from '../utils'
import { parseFrontmatter } from '@shared/frontmatter'
import path from 'node:path'

/**
 * Skill scanner — discovers skills from 3 sources:
 *
 * 1. **Plugin skills** — from active plugins via convention-over-configuration
 *    (manifest-declared paths or conventional `skills/` + `.claude/skills/`)
 * 2. **Global user skills** — `~/.claude/skills/`
 * 3. **Project skills** — `{project}/.claude/skills/`
 *
 * Naming convention (aligned with Claude Code CLI):
 * - Plugin skills: `{pluginName}:{skillName}` (e.g. `superpowers:brainstorming`)
 * - User/project skills: bare name (e.g. `my-skill`)
 */
export const skillScanner: CapabilityScanner<'skill'> = {
  category: 'skill',
  async scan(ctx) {
    const { paths, activePlugins } = ctx

    // Global: plugin skills (from active plugins only)
    const pluginSkills = await scanActivePluginSkills(activePlugins)

    // Global: user-defined skills (~/.claude/skills/)
    const userSkills = await scanSkillDir(paths.globalSkills, 'global', {
      scope: 'global',
      origin: 'user',
    })

    // Project: local skills
    let projectSkills: SkillEntry[] = []
    if (paths.project) {
      projectSkills = await scanSkillDir(paths.project.skills, 'project', {
        scope: 'project',
        origin: 'project',
      })
    }

    return {
      global: [...userSkills, ...pluginSkills].sort(byName),
      project: projectSkills.sort(byName),
    }
  },
}

// ---------------------------------------------------------------------------
// Plugin skill scanning
// ---------------------------------------------------------------------------

async function scanActivePluginSkills(plugins: ResolvedPlugin[]): Promise<SkillEntry[]> {
  const results = await Promise.all(
    plugins.map(plugin => scanSinglePluginSkills(plugin))
  )
  return results.flat()
}

async function scanSinglePluginSkills(plugin: ResolvedPlugin): Promise<SkillEntry[]> {
  const dirs = resolveCapabilityDirs(plugin, 'skills')
  const skills: SkillEntry[] = []

  for (const dir of dirs) {
    const entries = await safeDirEntries(dir)
    for (const entry of entries) {
      if (!entry.isDir) continue
      const skillFile = path.join(dir, entry.name, 'SKILL.md')
      const content = await safeReadFile(skillFile)
      if (content === null) continue

      const { attributes: fm } = parseFrontmatter(content)
      // Always prefix plugin skills with pluginName:
      // fm['name'] is the bare skill name (e.g. "brainstorming")
      const bareName = (fm['name'] as string) ?? entry.name
      const fullName = `${plugin.name}:${bareName}`

      skills.push({
        name: fullName,
        description: (fm['description'] as string) ?? '',
        source: {
          scope: 'global',
          origin: 'plugin',
          sourcePath: skillFile,
          mount: {
            name: plugin.name,
            marketplace: plugin.marketplace,
            version: plugin.version,
          },
        },
      })
    }
  }

  return skills
}

// ---------------------------------------------------------------------------
// User / project skill scanning
// ---------------------------------------------------------------------------

interface SourceTemplate {
  scope: CapabilityScope
  origin: CapabilitySource['origin']
}

async function scanSkillDir(
  dirPath: string,
  _scope: CapabilityScope,
  sourceTemplate: SourceTemplate,
): Promise<SkillEntry[]> {
  const entries = await safeDirEntries(dirPath)
  const skills: SkillEntry[] = []

  for (const entry of entries) {
    if (!entry.isDir) continue
    const skillFile = path.join(dirPath, entry.name, 'SKILL.md')
    const content = await safeReadFile(skillFile)
    if (content === null) continue

    const { attributes: fm } = parseFrontmatter(content)

    skills.push({
      name: (fm['name'] as string) ?? entry.name,
      description: (fm['description'] as string) ?? '',
      source: {
        scope: sourceTemplate.scope,
        origin: sourceTemplate.origin,
        sourcePath: skillFile,
      },
    })
  }

  return skills
}
