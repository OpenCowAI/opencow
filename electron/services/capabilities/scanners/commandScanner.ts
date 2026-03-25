// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { CommandEntry } from '@shared/types'
import type { ResolvedPlugin } from '../pluginResolver'
import { resolveCapabilityDirs } from '../pluginResolver'
import { scanMdDir, safeDirEntries, safeReadFile, byName } from '../utils'
import { parseFrontmatter } from '@shared/frontmatter'
import path from 'node:path'

const extractCommand = (fm: Record<string, unknown>) => ({
  argumentHint: (fm['argument-hint'] as string) ?? '',
})

/**
 * Command scanner — discovers commands from 3 sources:
 *
 * 1. **Plugin commands** — from active plugins (convention-over-configuration)
 * 2. **Global user commands** — `~/.claude/commands/`
 * 3. **Project commands** — `{project}/.claude/commands/`
 *
 * Plugin commands are prefixed: `{pluginName}:{commandName}`
 * User/project commands use bare names.
 */
export const commandScanner: CapabilityScanner<'command'> = {
  category: 'command',
  async scan(ctx) {
    const { paths, activePlugins } = ctx

    // Global: user commands
    const userCommands = await scanMdDir<CommandEntry>(
      paths.globalCommands, 'global', extractCommand
    )

    // Global: plugin commands (from active plugins only)
    const pluginCommands = await scanActivePluginCommands(activePlugins)

    // Project commands
    let projectCommands: CommandEntry[] = []
    if (paths.project) {
      projectCommands = await scanMdDir<CommandEntry>(
        paths.project.commands, 'project', extractCommand
      )
    }

    return {
      global: [...userCommands, ...pluginCommands].sort(byName),
      project: projectCommands.sort(byName),
    }
  },
}

// ---------------------------------------------------------------------------
// Plugin command scanning
// ---------------------------------------------------------------------------

async function scanActivePluginCommands(plugins: ResolvedPlugin[]): Promise<CommandEntry[]> {
  const results = await Promise.all(
    plugins.map(plugin => scanSinglePluginCommands(plugin))
  )
  return results.flat()
}

async function scanSinglePluginCommands(plugin: ResolvedPlugin): Promise<CommandEntry[]> {
  const dirs = resolveCapabilityDirs(plugin, 'commands')
  const commands: CommandEntry[] = []

  for (const dir of dirs) {
    const entries = await safeDirEntries(dir)
    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith('.md')) continue

      const fullPath = path.join(dir, entry.name)
      const content = await safeReadFile(fullPath)
      const fm = content ? parseFrontmatter(content).attributes : {}

      const bareName = (fm['name'] as string) ?? entry.name.replace('.md', '')
      const fullName = `${plugin.name}:${bareName}`

      commands.push({
        name: fullName,
        description: (fm['description'] as string) ?? '',
        argumentHint: (fm['argument-hint'] as string) ?? '',
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

  return commands
}
