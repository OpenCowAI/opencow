// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { resolve, join, sep } from 'node:path'
import os from 'node:os'

/**
 * Security policy for read-capability-source:
 *   Allow reading from ~/.claude/ (global) and {projectPath}/.claude/ (project-scoped).
 *   Reject all other paths.
 */

function isPathAllowed(sourcePath: string, projectPath?: string): boolean {
  const claudeDir = resolve(join(os.homedir(), '.claude'))
  const claudeJsonPath = resolve(join(os.homedir(), '.claude.json'))
  const resolved = resolve(sourcePath)

  const isWithinGlobalClaude = resolved.startsWith(claudeDir + sep) || resolved === claudeDir
  const isClaudeJson = resolved === claudeJsonPath
  const isWithinProjectClaude = projectPath
    ? resolved.startsWith(resolve(projectPath, '.claude') + sep)
    : false
  const isProjectMcpJson = projectPath
    ? resolved === resolve(projectPath, '.mcp.json')
    : false

  return isWithinGlobalClaude || isClaudeJson || isWithinProjectClaude || isProjectMcpJson
}

describe('read-capability-source security — global scope', () => {
  it('rejects paths outside ~/.claude/', () => {
    expect(isPathAllowed('/etc/passwd')).toBe(false)
  })

  it('rejects relative traversal paths', () => {
    const claudeDir = resolve(join(os.homedir(), '.claude'))
    const traversal = join(claudeDir, '..', '..', 'etc', 'passwd')
    expect(isPathAllowed(traversal)).toBe(false)
  })

  it('accepts paths inside ~/.claude/', () => {
    const valid = join(os.homedir(), '.claude', 'commands', 'commit.md')
    expect(isPathAllowed(valid)).toBe(true)
  })

  it('accepts deep nested paths inside ~/.claude/', () => {
    const valid = join(os.homedir(), '.claude', 'plugins', 'cache', 'some-plugin', '1.0.0', 'skills', 'SKILL.md')
    expect(isPathAllowed(valid)).toBe(true)
  })
})

describe('read-capability-source security — project scope', () => {
  const projectPath = '/Users/test/workspace/my-project'

  it('accepts project-scoped skill paths', () => {
    const skillPath = join(projectPath, '.claude', 'skills', 'my-skill', 'SKILL.md')
    expect(isPathAllowed(skillPath, projectPath)).toBe(true)
  })

  it('accepts project-scoped command paths', () => {
    const cmdPath = join(projectPath, '.claude', 'commands', 'deploy.md')
    expect(isPathAllowed(cmdPath, projectPath)).toBe(true)
  })

  it('rejects project paths outside .claude/', () => {
    const outsidePath = join(projectPath, 'src', 'secret.ts')
    expect(isPathAllowed(outsidePath, projectPath)).toBe(false)
  })

  it('rejects traversal from project .claude/', () => {
    const traversal = join(projectPath, '.claude', '..', '..', 'etc', 'passwd')
    expect(isPathAllowed(traversal, projectPath)).toBe(false)
  })

  it('rejects arbitrary paths even with projectPath provided', () => {
    expect(isPathAllowed('/etc/passwd', projectPath)).toBe(false)
  })

  it('project-scoped path rejected without projectPath', () => {
    const skillPath = join(projectPath, '.claude', 'skills', 'my-skill', 'SKILL.md')
    expect(isPathAllowed(skillPath)).toBe(false)
  })
})

describe('read-capability-source security — MCP paths', () => {
  it('accepts ~/.claude.json', () => {
    const claudeJson = join(os.homedir(), '.claude.json')
    expect(isPathAllowed(claudeJson)).toBe(true)
  })

  it('accepts project-root .mcp.json', () => {
    const projectPath = '/Users/test/workspace/my-project'
    const mcpJson = join(projectPath, '.mcp.json')
    expect(isPathAllowed(mcpJson, projectPath)).toBe(true)
  })

  it('rejects .mcp.json without projectPath', () => {
    const mcpJson = '/Users/test/workspace/my-project/.mcp.json'
    expect(isPathAllowed(mcpJson)).toBe(false)
  })

  it('rejects other dotfiles in home directory', () => {
    const bashrc = join(os.homedir(), '.bashrc')
    expect(isPathAllowed(bashrc)).toBe(false)
  })
})

describe('directory config aggregation', () => {
  it('produces JSON output from aggregated files', () => {
    const pluginJson = { name: 'github', description: 'GitHub MCP' }
    const mcpJson = { github: { type: 'http' } }
    const aggregated = JSON.stringify({ 'plugin.json': pluginJson, '.mcp.json': mcpJson }, null, 2)

    expect(aggregated).toContain('"github"')
    expect(aggregated).toContain('"http"')
  })
})
