// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import os from 'node:os'
import { APP_FS_NAME } from '@shared/appIdentity'

/**
 * Centralized security validator for all capability file operations.
 * Used by: read-capability-source IPC, trashService, capabilityWriteService, CapabilityStore.
 *
 * Allowed paths:
 * - ~/.claude/** (global capabilities — legacy Claude Code)
 * - ~/.claude.json (global MCP config)
 * - ~/.opencow/** and ~/.opencow-dev/** (Capability Center global store — prod & dev)
 * - {projectPath}/.claude/** (project capabilities — legacy Claude Code)
 * - {projectPath}/.opencow/** and .opencow-dev/** (project Capability Center store)
 * - {projectPath}/.mcp.json (project MCP config)
 * - {projectPath}/CLAUDE.md (project rules)
 */
export function isAllowedCapabilityPath(targetPath: string, projectPath?: string): boolean {
  const resolved = path.resolve(targetPath)

  // Legacy Claude Code paths
  const claudeDir = path.resolve(path.join(os.homedir(), '.claude'))
  const claudeJsonPath = path.resolve(path.join(os.homedir(), '.claude.json'))

  if (resolved.startsWith(claudeDir + path.sep) || resolved === claudeDir) return true
  if (resolved === claudeJsonPath) return true

  // Capability Center global store: ~/.opencow/ (prod) and ~/.opencow-dev/ (dev)
  // Both are OpenCow-managed directories; allowing both keeps the validator
  // environment-agnostic without importing Electron-dependent isDev().
  const opencowDir = path.resolve(path.join(os.homedir(), `.${APP_FS_NAME}`))
  const opencowDevDir = path.resolve(path.join(os.homedir(), `.${APP_FS_NAME}-dev`))
  if (resolved.startsWith(opencowDir + path.sep) || resolved === opencowDir) return true
  if (resolved.startsWith(opencowDevDir + path.sep) || resolved === opencowDevDir) return true

  if (projectPath) {
    // Legacy project Claude Code paths
    const projectClaudeDir = path.resolve(projectPath, '.claude')
    if (resolved.startsWith(projectClaudeDir + path.sep)) return true
    if (resolved === path.resolve(projectPath, '.mcp.json')) return true
    if (resolved === path.resolve(projectPath, 'CLAUDE.md')) return true

    // Project-level Capability Center store: {project}/.opencow/ or .opencow-dev/
    const projectOpencowDir = path.resolve(projectPath, `.${APP_FS_NAME}`)
    const projectOpencowDevDir = path.resolve(projectPath, `.${APP_FS_NAME}-dev`)
    if (resolved.startsWith(projectOpencowDir + path.sep)) return true
    if (resolved.startsWith(projectOpencowDevDir + path.sep)) return true
  }

  return false
}

/**
 * Throws if the path is outside allowed directories.
 * Use this as a guard at the beginning of any file operation.
 */
export function validateCapabilityPath(targetPath: string, projectPath?: string): void {
  if (!isAllowedCapabilityPath(targetPath, projectPath)) {
    throw new Error('Access denied: path outside allowed capability directories')
  }
}
