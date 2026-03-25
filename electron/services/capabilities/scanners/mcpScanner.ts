// SPDX-License-Identifier: Apache-2.0

import type { CapabilityScanner } from '../types'
import type { MCPServerEntry } from '@shared/types'
import { safeDirEntries, safeReadFile, safeReadJson, byName } from '../utils'
import path from 'node:path'

export const mcpScanner: CapabilityScanner<'mcp-server'> = {
  category: 'mcp-server',
  async scan(ctx) {
    const { paths } = ctx

    // Global: marketplace MCP + claude.json global MCP
    const [marketplaceMCP, claudeJsonResult] = await Promise.all([
      scanMCPFromMarketplace(paths.marketplaces),
      scanMCPFromClaudeJson(paths.claudeJson, paths.project?.root),
    ])

    const globalServers = [...marketplaceMCP, ...claudeJsonResult.global]

    // Project: claude.json project MCP + .mcp.json
    let projectServers = [...claudeJsonResult.project]
    if (paths.project) {
      const projectJsonMCP = await scanMCPFromProjectJson(paths.project.mcpJson)
      projectServers = [...projectServers, ...projectJsonMCP]
    }

    return {
      global: globalServers.sort(byName),
      project: projectServers.sort(byName),
    }
  }
}

/** Scan MCP servers from marketplace external_plugins directories */
async function scanMCPFromMarketplace(marketplacesDir: string): Promise<MCPServerEntry[]> {
  const marketplaces = await safeDirEntries(marketplacesDir)
  const servers: MCPServerEntry[] = []

  for (const marketplace of marketplaces) {
    if (!marketplace.isDir) continue
    const externalDir = path.join(marketplacesDir, marketplace.name, 'external_plugins')
    const plugins = await safeDirEntries(externalDir)

    for (const plugin of plugins) {
      if (!plugin.isDir) continue
      const pluginDir = path.join(externalDir, plugin.name)

      // Read plugin.json for metadata
      const pluginJsonPath = path.join(pluginDir, '.claude-plugin', 'plugin.json')
      const meta = await safeReadJson(pluginJsonPath)

      // Read .mcp.json for server type
      const mcpJsonPath = path.join(pluginDir, '.mcp.json')
      const mcpJson = await safeReadFile(mcpJsonPath)
      let serverType = ''
      if (mcpJson) {
        try {
          const mcpConfig = JSON.parse(mcpJson) as Record<string, Record<string, string>>
          const serverConfig = mcpConfig[plugin.name]
          serverType = serverConfig?.['type'] ?? ''
        } catch {
          // ignore parse errors
        }
      }

      const authorObj = meta['author'] as Record<string, string> | undefined

      servers.push({
        name: (meta['name'] as string) ?? plugin.name,
        description: (meta['description'] as string) ?? '',
        author: authorObj?.['name'] ?? '',
        serverType,
        source: { scope: 'global', origin: 'marketplace', sourcePath: pluginDir },
      })
    }
  }

  return servers
}

/** Scan ~/.claude.json for MCP server configurations */
async function scanMCPFromClaudeJson(
  claudeJsonPath: string,
  projectRoot?: string
): Promise<{ global: MCPServerEntry[]; project: MCPServerEntry[] }> {
  const content = await safeReadFile(claudeJsonPath)
  if (!content) return { global: [], project: [] }

  try {
    const data = JSON.parse(content) as Record<string, unknown>
    const globalServers: MCPServerEntry[] = []
    const projectServers: MCPServerEntry[] = []

    // User-scope: top-level mcpServers
    const userMcp = data['mcpServers'] as Record<string, Record<string, unknown>> | undefined
    if (userMcp && typeof userMcp === 'object') {
      for (const [name, config] of Object.entries(userMcp)) {
        globalServers.push({
          name,
          description: '',
          author: '',
          serverType: (config['type'] as string) ?? '',
          source: { scope: 'global', origin: 'config-file', sourcePath: claudeJsonPath },
        })
      }
    }

    // Local-scope: projects[projectPath].mcpServers
    if (projectRoot) {
      const projects = data['projects'] as Record<string, Record<string, unknown>> | undefined
      if (projects && typeof projects === 'object') {
        const projectData = projects[projectRoot]
        const localMcp = projectData?.['mcpServers'] as Record<string, Record<string, unknown>> | undefined
        if (localMcp && typeof localMcp === 'object') {
          for (const [name, config] of Object.entries(localMcp)) {
            projectServers.push({
              name,
              description: '',
              author: '',
              serverType: (config['type'] as string) ?? '',
              source: { scope: 'project', origin: 'config-file', sourcePath: claudeJsonPath },
            })
          }
        }
      }
    }

    return { global: globalServers, project: projectServers }
  } catch {
    return { global: [], project: [] }
  }
}

/** Scan project-root .mcp.json for shared MCP server configurations */
async function scanMCPFromProjectJson(mcpJsonPath: string): Promise<MCPServerEntry[]> {
  const content = await safeReadFile(mcpJsonPath)
  if (!content) return []

  try {
    const data = JSON.parse(content) as Record<string, unknown>
    // .mcp.json can have mcpServers wrapper or be flat
    const servers = (data['mcpServers'] ?? data) as Record<string, Record<string, unknown>>
    const result: MCPServerEntry[] = []

    for (const [name, config] of Object.entries(servers)) {
      if (typeof config !== 'object' || config === null) continue
      result.push({
        name,
        description: '',
        author: '',
        serverType: (config['type'] as string) ?? '',
        source: { scope: 'project', origin: 'config-file', sourcePath: mcpJsonPath },
      })
    }

    return result
  } catch {
    return []
  }
}
