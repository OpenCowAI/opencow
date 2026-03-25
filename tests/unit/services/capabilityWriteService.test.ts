// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import os from 'node:os'

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{}'),
  }
}))

vi.mock('../../../electron/services/trashService', () => ({
  moveToTrash: vi.fn().mockResolvedValue({ success: true, trashPath: '/trash/path' })
}))

vi.mock('../../../electron/security/pathValidator', () => ({
  validateCapabilityPath: vi.fn()
}))

import { saveCapability, deleteCapability } from '../../../electron/services/capabilityWriteService'
import fs from 'node:fs/promises'
import { moveToTrash } from '../../../electron/services/trashService'

describe('capabilityWriteService', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('saveCapability', () => {
    it('saves command as markdown with frontmatter', async () => {
      const result = await saveCapability({
        category: 'command',
        scope: 'project',
        projectPath: '/project',
        name: 'deploy',
        data: { description: 'Deploy', argumentHint: '<env>', body: '# Deploy' }
      })

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/project', '.claude', 'commands', 'deploy.md'),
        expect.stringContaining('description: Deploy'),
        'utf-8'
      )
      expect(result.success).toBe(true)
    })

    it('saves agent with model and color in frontmatter', async () => {
      await saveCapability({
        category: 'agent',
        scope: 'global',
        name: 'reviewer',
        data: { description: 'Reviews', model: 'sonnet', color: '#f00', body: '# Agent' }
      })

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(path.join('.claude', 'agents', 'reviewer.md')),
        expect.stringContaining('model: sonnet'),
        'utf-8'
      )
    })

    it('saves skill as directory with SKILL.md', async () => {
      await saveCapability({
        category: 'skill',
        scope: 'project',
        projectPath: '/project',
        name: 'my-skill',
        data: { description: 'Test', body: '---\nname: my-skill\n---\nBody' }
      })

      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join('/project', '.claude', 'skills', 'my-skill'),
        { recursive: true }
      )
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/project', '.claude', 'skills', 'my-skill', 'SKILL.md'),
        expect.any(String), 'utf-8'
      )
    })

    it('saves hook preserving OpenCow rules', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        hooks: {
          SessionStart: [
            { __opencow__: true, hooks: [{ type: 'command', command: 'opencow-hook.sh' }] },
            { hooks: [{ type: 'command', command: 'old-user.sh' }] }
          ]
        }
      }))

      await saveCapability({
        category: 'hook',
        scope: 'project',
        projectPath: '/project',
        name: 'SessionStart',
        data: { rules: [{ type: 'command', command: 'new-user.sh' }] }
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.hooks.SessionStart[0].__opencow__).toBe(true)
      const userGroup = written.hooks.SessionStart.find((g: any) => !g.__opencow__)
      expect(userGroup.hooks[0].command).toBe('new-user.sh')
    })

    it('saves MCP server to .mcp.json for project scope', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"mcpServers":{}}')

      await saveCapability({
        category: 'mcp-server',
        scope: 'project',
        projectPath: '/project',
        name: 'srv',
        data: { type: 'stdio', command: 'npx', args: [], env: {}, configFile: '.mcp.json' }
      })

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/project', '.mcp.json'),
        expect.stringContaining('"srv"'), 'utf-8'
      )
    })

    it('saves MCP server to .claude.json global mcpServers', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"mcpServers":{}}')

      await saveCapability({
        category: 'mcp-server',
        scope: 'global',
        name: 'gsrv',
        data: { type: 'stdio', command: 'node', args: [], env: {}, configFile: '.claude.json' }
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.mcpServers.gsrv).toBeDefined()
    })

    it('saves MCP server to .claude.json project mcpServers', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('{"projects":{}}')

      await saveCapability({
        category: 'mcp-server',
        scope: 'project',
        projectPath: '/project',
        name: 'psrv',
        data: { type: 'sse', command: 'node', args: [], env: {}, configFile: '.claude.json' }
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.projects['/project'].mcpServers.psrv).toBeDefined()
    })
  })

  describe('deleteCapability', () => {
    it('moves file-based capabilities to trash', async () => {
      await deleteCapability({
        category: 'command', scope: 'project', projectPath: '/project',
        name: 'deploy', sourcePath: '/project/.claude/commands/deploy.md'
      })

      expect(moveToTrash).toHaveBeenCalledWith('/project/.claude/commands/deploy.md', '/project')
    })

    it('deletes hook user rules but preserves OpenCow rules', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        hooks: {
          SessionStart: [
            { __opencow__: true, hooks: [{ type: 'command', command: 'opencow-hook.sh' }] },
            { hooks: [{ type: 'command', command: 'user.sh' }] }
          ]
        }
      }))

      await deleteCapability({
        category: 'hook', scope: 'project', projectPath: '/project',
        name: 'SessionStart', sourcePath: '/project/.claude/settings.json'
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.hooks.SessionStart).toHaveLength(1)
      expect(written.hooks.SessionStart[0].__opencow__).toBe(true)
    })

    it('fully removes hook event when no OpenCow rules exist', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'user.sh' }] }],
          Stop: [{ hooks: [{ type: 'command', command: 'other.sh' }] }]
        }
      }))

      await deleteCapability({
        category: 'hook', scope: 'project', projectPath: '/project',
        name: 'SessionStart', sourcePath: '/project/.claude/settings.json'
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.hooks.SessionStart).toBeUndefined()
      expect(written.hooks.Stop).toBeDefined()
    })

    it('deletes MCP server from .mcp.json', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        mcpServers: { srv: { type: 'stdio' }, other: { type: 'sse' } }
      }))

      await deleteCapability({
        category: 'mcp-server', scope: 'project', projectPath: '/project',
        name: 'srv', sourcePath: '/project/.mcp.json'
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.mcpServers.srv).toBeUndefined()
      expect(written.mcpServers.other).toBeDefined()
    })

    it('deletes MCP server from .claude.json project scope', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        mcpServers: { global: { type: 'stdio' } },
        projects: { '/project': { mcpServers: { psrv: { type: 'sse' } } } }
      }))

      await deleteCapability({
        category: 'mcp-server', scope: 'project', projectPath: '/project',
        name: 'psrv', sourcePath: path.join(os.homedir(), '.claude.json')
      })

      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
      expect(written.projects['/project'].mcpServers.psrv).toBeUndefined()
      expect(written.mcpServers.global).toBeDefined()
    })
  })
})
