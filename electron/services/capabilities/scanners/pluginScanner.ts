// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { PluginEntry } from '@shared/types'
import type { ResolvedPlugin } from '../pluginResolver'
import { resolveCapabilityDirs, resolveHooksFile } from '../pluginResolver'
import { safeDirEntries, safeReadFile, byName } from '../utils'

/**
 * Plugin scanner — lists all installed plugins for the Capabilities UI.
 *
 * Uses `ctx.allPlugins` (including disabled/blocked) so the UI can show
 * the full inventory with enable/disable/blocked status indicators.
 *
 * All plugin resolution (parsing installed_plugins.json, settings, blocklist)
 * is handled upstream by the Plugin Resolver — this scanner is purely a mapper.
 */
export const pluginScanner: CapabilityScanner<'plugin'> = {
  category: 'plugin',
  async scan(ctx) {
    const plugins: PluginEntry[] = await Promise.all(
      ctx.allPlugins.map(p => resolvedToEntry(p))
    )

    return {
      global: plugins.sort(byName),
      project: [], // plugins are always global
    }
  },
}

async function resolvedToEntry(plugin: ResolvedPlugin): Promise<PluginEntry> {
  const manifest = plugin.manifest
  const capabilities = await countCapabilities(plugin)

  return {
    name: manifest?.name ?? plugin.name,
    description: manifest?.description ?? '',
    source: {
      scope: 'global',
      origin: 'plugin',
      sourcePath: plugin.installPath,
      mount: {
        name: plugin.name,
        marketplace: plugin.marketplace,
        version: plugin.version,
      },
    },
    marketplace: plugin.marketplace,
    version: plugin.version,
    author: manifest?.author?.name ?? '',
    enabled: plugin.enabled,
    blocked: plugin.blocked,
    installScope: plugin.installScope,
    capabilities,
  }
}

async function countCapabilities(
  plugin: ResolvedPlugin,
): Promise<PluginEntry['capabilities']> {
  const countDirs = async (dirs: string[]): Promise<number> => {
    let total = 0
    for (const dir of dirs) {
      const entries = await safeDirEntries(dir)
      total += entries.length
    }
    return total
  }

  const [commands, skills, agents] = await Promise.all([
    countDirs(resolveCapabilityDirs(plugin, 'commands')),
    countDirs(resolveCapabilityDirs(plugin, 'skills')),
    countDirs(resolveCapabilityDirs(plugin, 'agents')),
  ])

  // Count hook events
  let hooks = 0
  const hooksContent = await safeReadFile(resolveHooksFile(plugin))
  if (hooksContent) {
    try {
      const data = JSON.parse(hooksContent) as Record<string, unknown>
      // hooks.json format: { hooks: { EventName: [...] } } or { EventName: [...] }
      const hooksObj = (data['hooks'] as Record<string, unknown>) ?? data
      hooks = Object.keys(hooksObj).length
    } catch { /* ignore parse errors */ }
  }

  return { commands, skills, agents, hooks }
}
