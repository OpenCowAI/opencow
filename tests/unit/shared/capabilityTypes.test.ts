// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type {
  DetailContext,
  SaveCapabilityParams,
  DeleteCapabilityParams,
  SaveCapabilityResult,
  DeleteCapabilityResult,
} from '@shared/types'

describe('Capability Management Types — Discriminated Unions', () => {
  it('DetailContext supports capability-edit variant', () => {
    const ctx: DetailContext = {
      type: 'capability-edit',
      identifier: { category: 'command', name: 'test', source: { scope: 'project', origin: 'project', sourcePath: '/p' } }
    }
    expect(ctx.type).toBe('capability-edit')
  })

  it('DetailContext supports capability-create variant', () => {
    const ctx: DetailContext = {
      type: 'capability-create',
      category: 'agent',
      scope: 'global'
    }
    expect(ctx.type).toBe('capability-create')
  })

  it('SaveCapabilityParams enforces category-data binding for command', () => {
    const params: SaveCapabilityParams = {
      category: 'command',
      scope: 'project',
      projectPath: '/project',
      name: 'deploy',
      data: { description: 'Deploy', argumentHint: '<env>', body: '# Deploy' }
    }
    // TypeScript ensures data MUST be CommandFormData when category is 'command'
    expect(params.data.body).toBeDefined()
    expect(params.data.description).toBeDefined()
  })

  it('SaveCapabilityParams enforces category-data binding for hook', () => {
    const params: SaveCapabilityParams = {
      category: 'hook',
      scope: 'project',
      projectPath: '/project',
      name: 'SessionStart',
      data: { rules: [{ type: 'command', command: 'test.sh' }] }
    }
    expect(params.data.rules).toHaveLength(1)
  })

  it('SaveCapabilityParams enforces category-data binding for mcp-server', () => {
    const params: SaveCapabilityParams = {
      category: 'mcp-server',
      scope: 'project',
      projectPath: '/project',
      name: 'server',
      data: { type: 'stdio', command: 'npx', args: [], env: {}, configFile: '.mcp.json' }
    }
    expect(params.data.configFile).toBe('.mcp.json')
  })

  it('DeleteCapabilityParams distinguishes file-based vs config-based', () => {
    const fileDelete: DeleteCapabilityParams = {
      category: 'command',
      scope: 'project',
      projectPath: '/project',
      name: 'deploy',
      sourcePath: '/project/.claude/commands/deploy.md'
    }
    expect(fileDelete.sourcePath).toBeDefined()

    const configDelete: DeleteCapabilityParams = {
      category: 'hook',
      scope: 'project',
      projectPath: '/project',
      name: 'SessionStart',
      sourcePath: '/project/.claude/settings.json'
    }
    expect(configDelete.name).toBe('SessionStart')
  })

  it('SaveCapabilityResult and DeleteCapabilityResult have correct shapes', () => {
    const saveResult: SaveCapabilityResult = { success: true, sourcePath: '/path' }
    const deleteResult: DeleteCapabilityResult = { success: true, trashPath: '/trash' }
    expect(saveResult.success).toBe(true)
    expect(deleteResult.trashPath).toBeDefined()
  })
})
