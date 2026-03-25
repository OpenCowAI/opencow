// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { validateCapabilityPath } from '../security/pathValidator'
import { moveToTrash } from './trashService'
import { buildFrontmatter } from '@shared/frontmatter'
import { HOOK_MARKER_KEY } from '@shared/appIdentity'
import type {
  SaveCapabilityParams,
  DeleteCapabilityParams,
  SaveCapabilityResult,
  DeleteCapabilityResult
} from '@shared/types'

// === Helpers ===

async function safeReadJson(filePath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function getBaseDir(scope: string, projectPath?: string): string {
  return scope === 'project' && projectPath
    ? path.join(projectPath, '.claude')
    : path.join(os.homedir(), '.claude')
}

// === Save (Discriminated Union — TypeScript narrows params.data per category) ===

export async function saveCapability(params: SaveCapabilityParams): Promise<SaveCapabilityResult> {
  switch (params.category) {
    case 'command': {
      const { data } = params
      const dir = path.join(getBaseDir(params.scope, params.projectPath), 'commands')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${params.name}.md`)
      validateCapabilityPath(filePath, params.projectPath)
      const fm = buildFrontmatter({
        description: data.description,
        'argument-hint': data.argumentHint
      })
      await fs.writeFile(filePath, `${fm}\n\n${data.body}`, 'utf-8')
      return { success: true, sourcePath: filePath }
    }

    case 'agent': {
      const { data } = params
      const dir = path.join(getBaseDir(params.scope, params.projectPath), 'agents')
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${params.name}.md`)
      validateCapabilityPath(filePath, params.projectPath)
      const fm = buildFrontmatter({
        name: params.name,
        description: data.description,
        model: data.model,
        color: data.color
      })
      await fs.writeFile(filePath, `${fm}\n\n${data.body}`, 'utf-8')
      return { success: true, sourcePath: filePath }
    }

    case 'skill': {
      const { data } = params
      const skillDir = path.join(
        getBaseDir(params.scope, params.projectPath),
        'skills',
        params.name
      )
      await fs.mkdir(skillDir, { recursive: true })
      const filePath = path.join(skillDir, 'SKILL.md')
      validateCapabilityPath(filePath, params.projectPath)
      await fs.writeFile(filePath, data.body, 'utf-8')
      return { success: true, sourcePath: filePath }
    }

    case 'hook': {
      const { data } = params
      const settingsPath = path.join(getBaseDir(params.scope, params.projectPath), 'settings.json')
      validateCapabilityPath(settingsPath, params.projectPath)
      const settings = await safeReadJson(settingsPath)
      const hooks = (settings['hooks'] ?? {}) as Record<string, unknown[]>

      const existing = Array.isArray(hooks[params.name]) ? hooks[params.name] : []
      const managedGroups = existing.filter(
        (g) => (g as Record<string, unknown>)[HOOK_MARKER_KEY] === true
      )
      hooks[params.name] = [
        ...managedGroups,
        { hooks: data.rules.map((r) => ({ type: r.type, command: r.command })) }
      ]
      settings['hooks'] = hooks

      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      return { success: true, sourcePath: settingsPath }
    }

    case 'mcp-server': {
      const { data } = params
      const serverConfig: Record<string, unknown> = { type: data.type, command: data.command }
      if (data.args.length > 0) serverConfig['args'] = data.args
      if (Object.keys(data.env).length > 0) serverConfig['env'] = data.env

      if (data.configFile === '.mcp.json' && !params.projectPath) {
        throw new Error('projectPath is required when configFile is .mcp.json')
      }

      const configPath =
        data.configFile === '.mcp.json'
          ? path.join(params.projectPath!, '.mcp.json')
          : path.join(os.homedir(), '.claude.json')
      validateCapabilityPath(configPath, params.projectPath)

      const config = await safeReadJson(configPath)

      if (data.configFile === '.mcp.json') {
        const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>
        mcpServers[params.name] = serverConfig
        config['mcpServers'] = mcpServers
      } else if (params.scope === 'global') {
        const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>
        mcpServers[params.name] = serverConfig
        config['mcpServers'] = mcpServers
      } else if (params.projectPath) {
        const projects = (config['projects'] ?? {}) as Record<string, Record<string, unknown>>
        const proj = projects[params.projectPath] ?? {}
        const mcpServers = (proj['mcpServers'] ?? {}) as Record<string, unknown>
        mcpServers[params.name] = serverConfig
        proj['mcpServers'] = mcpServers
        projects[params.projectPath] = proj
        config['projects'] = projects
      }

      await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
      return { success: true, sourcePath: configPath }
    }
  }
}

// === Delete ===

export async function deleteCapability(
  params: DeleteCapabilityParams
): Promise<DeleteCapabilityResult> {
  if (params.category === 'hook') {
    const settingsPath = path.join(getBaseDir(params.scope, params.projectPath), 'settings.json')
    validateCapabilityPath(settingsPath, params.projectPath)
    const settings = await safeReadJson(settingsPath)
    const hooks = (settings['hooks'] ?? {}) as Record<string, unknown[]>

    const existing = Array.isArray(hooks[params.name]) ? hooks[params.name] : []
    const managedGroups = existing.filter(
      (g) => (g as Record<string, unknown>)[HOOK_MARKER_KEY] === true
    )

    if (managedGroups.length > 0) {
      hooks[params.name] = managedGroups // preserve OpenCow managed rules
    } else {
      delete hooks[params.name]
    }
    settings['hooks'] = hooks
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    return { success: true }
  }

  if (params.category === 'mcp-server') {
    const configPath = params.sourcePath
    validateCapabilityPath(configPath, params.projectPath)
    const config = await safeReadJson(configPath)

    const claudeJsonPath = path.resolve(path.join(os.homedir(), '.claude.json'))
    const isClaudeJson = path.resolve(configPath) === claudeJsonPath

    if (isClaudeJson && params.scope === 'project' && params.projectPath) {
      // Delete from projects[path].mcpServers
      const projects = (config['projects'] ?? {}) as Record<string, Record<string, unknown>>
      const proj = projects[params.projectPath]
      if (proj) {
        const mcpServers = (proj['mcpServers'] ?? {}) as Record<string, unknown>
        delete mcpServers[params.name]
        proj['mcpServers'] = mcpServers
        projects[params.projectPath] = proj
        config['projects'] = projects
      }
    } else if (isClaudeJson) {
      // Delete from top-level mcpServers (global)
      const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>
      delete mcpServers[params.name]
      config['mcpServers'] = mcpServers
    } else {
      // .mcp.json — delete from mcpServers wrapper or flat format
      const mcpServers = (config['mcpServers'] ?? config) as Record<string, unknown>
      delete mcpServers[params.name]
      if (config['mcpServers']) {
        config['mcpServers'] = mcpServers
      }
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    return { success: true }
  }

  // File-based capabilities: move to trash
  const result = await moveToTrash(params.sourcePath, params.projectPath)
  return { success: result.success, trashPath: result.trashPath }
}
