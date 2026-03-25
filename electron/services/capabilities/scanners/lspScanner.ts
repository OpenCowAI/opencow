// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { LSPServerEntry } from '@shared/types'
import { safeReadJson, safeDirEntries, byName } from '../utils'
import path from 'node:path'

export const lspScanner: CapabilityScanner<'lsp-server'> = {
  category: 'lsp-server',
  async scan(ctx) {
    const { paths } = ctx
    const servers: LSPServerEntry[] = []

    const marketplaces = await safeDirEntries(paths.marketplaces)
    for (const marketplace of marketplaces) {
      if (!marketplace.isDir) continue

      const manifestPath = path.join(
        paths.marketplaces,
        marketplace.name,
        '.claude-plugin',
        'marketplace.json'
      )
      const manifest = await safeReadJson(manifestPath)
      const pluginsList = manifest['plugins'] as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(pluginsList)) continue

      for (const plugin of pluginsList) {
        const lspServers = plugin['lspServers'] as Array<Record<string, unknown>> | undefined
        if (!Array.isArray(lspServers)) continue

        for (const lsp of lspServers) {
          servers.push({
            name: (lsp['name'] as string) ?? 'Unknown LSP',
            description: (lsp['description'] as string) ?? '',
            source: {
              scope: 'global',
              origin: 'marketplace',
              sourcePath: manifestPath,
            },
            command: (lsp['command'] as string) ?? '',
            args: (lsp['args'] as string[]) ?? [],
            languages: (lsp['languages'] as string[]) ?? [],
          })
        }
      }
    }

    return {
      global: servers.sort(byName),
      project: [], // LSP servers are marketplace-level only
    }
  }
}
