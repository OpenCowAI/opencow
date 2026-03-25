// SPDX-License-Identifier: Apache-2.0

import type { ClaudeCapabilities, CapabilityCategory, ScopedList } from '@shared/types'
import type { ScanContext } from './types'
import { resolveClaudeCodePaths } from './paths'
import { resolvePlugins } from './pluginResolver'
import { scannerRegistry } from './registry'
import { createLogger } from '../../platform/logger'

const log = createLogger('Capabilities')

/**
 * List all Claude Code capabilities — the single public entry point.
 *
 * Pipeline:
 * 1. Resolve paths
 * 2. Resolve plugins (parse installed_plugins.json + settings + blocklist ONCE)
 * 3. Build ScanContext with activePlugins / allPlugins
 * 4. Run all scanners in parallel — each consumes the shared context
 *
 * Individual scanner failures are isolated — a broken scanner returns an empty
 * ScopedList rather than crashing the entire capability listing.
 */
export async function listClaudeCapabilities(
  projectPath?: string
): Promise<ClaudeCapabilities> {
  const paths = resolveClaudeCodePaths(projectPath)

  // Resolve all plugins once — shared by every scanner
  const allPlugins = await resolvePlugins(paths)
  const activePlugins = allPlugins.filter(p => p.enabled && !p.blocked)

  const ctx: ScanContext = { paths, activePlugins, allPlugins }

  const results = await Promise.all(
    scannerRegistry.map(async (scanner) => {
      try {
        const list = await scanner.scan(ctx)
        return [scanner.category, list] as const
      } catch (err) {
        log.error(`Scanner "${scanner.category}" failed`, err)
        const empty: ScopedList<never> = { project: [], global: [] }
        return [scanner.category, empty] as [CapabilityCategory, ScopedList<never>]
      }
    })
  )

  const caps = Object.fromEntries(results) as ClaudeCapabilities
  const total = results.reduce(
    (sum, [, list]) => sum + list.project.length + list.global.length,
    0
  )
  log.info(
    `Scanned ${scannerRegistry.length} categories, found ${total} capabilities ` +
    `(${activePlugins.length} active plugins / ${allPlugins.length} total)`
  )
  return caps
}
