// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { AgentEntry } from '@shared/types'
import type { ResolvedPlugin } from '../pluginResolver'
import { resolveCapabilityDirs } from '../pluginResolver'
import { scanMdDir, safeDirEntries, safeReadFile, byName } from '../utils'
import { parseFrontmatter } from '@shared/frontmatter'
import path from 'node:path'

const extractAgent = (fm: Record<string, unknown>) => ({
  model: (fm['model'] as string) ?? '',
  color: (fm['color'] as string) ?? '',
})

/**
 * Agent scanner — discovers agents from 3 sources:
 *
 * 1. **Plugin agents** — from active plugins (convention-over-configuration)
 * 2. **Global user agents** — `~/.claude/agents/`
 * 3. **Project agents** — `{project}/.claude/agents/`
 *
 * Plugin agents are prefixed: `{pluginName}:{agentName}`
 * User/project agents use bare names.
 */
export const agentScanner: CapabilityScanner<'agent'> = {
  category: 'agent',
  async scan(ctx) {
    const { paths, activePlugins } = ctx

    // Global: user agents
    const userAgents = await scanMdDir<AgentEntry>(
      paths.globalAgents, 'global', extractAgent
    )

    // Global: plugin agents (from active plugins only)
    const pluginAgents = await scanActivePluginAgents(activePlugins)

    // Project agents
    let projectAgents: AgentEntry[] = []
    if (paths.project) {
      const agentsDir = path.join(paths.project.claudeDir, 'agents')
      projectAgents = await scanMdDir<AgentEntry>(
        agentsDir, 'project', extractAgent
      )
    }

    return {
      global: [...userAgents, ...pluginAgents].sort(byName),
      project: projectAgents.sort(byName),
    }
  },
}

// ---------------------------------------------------------------------------
// Plugin agent scanning
// ---------------------------------------------------------------------------

async function scanActivePluginAgents(plugins: ResolvedPlugin[]): Promise<AgentEntry[]> {
  const results = await Promise.all(
    plugins.map(plugin => scanSinglePluginAgents(plugin))
  )
  return results.flat()
}

async function scanSinglePluginAgents(plugin: ResolvedPlugin): Promise<AgentEntry[]> {
  const dirs = resolveCapabilityDirs(plugin, 'agents')
  const agents: AgentEntry[] = []

  for (const dir of dirs) {
    const entries = await safeDirEntries(dir)
    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith('.md')) continue

      const fullPath = path.join(dir, entry.name)
      const content = await safeReadFile(fullPath)
      const fm = content ? parseFrontmatter(content).attributes : {}

      const bareName = (fm['name'] as string) ?? entry.name.replace('.md', '')
      const fullName = `${plugin.name}:${bareName}`

      agents.push({
        name: fullName,
        description: (fm['description'] as string) ?? '',
        model: (fm['model'] as string) ?? '',
        color: (fm['color'] as string) ?? '',
        source: {
          scope: 'global',
          origin: 'plugin',
          sourcePath: fullPath,
          mount: {
            name: plugin.name,
            marketplace: plugin.marketplace,
            version: plugin.version,
          },
        },
      })
    }
  }

  return agents
}
