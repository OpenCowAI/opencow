// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  applyClaudeSessionPolicy,
  createClaudeCanUseToolPolicy,
} from '../../../electron/command/enginePolicy'

describe('enginePolicy', () => {
  it('auto-approves plan-mode tools and logs decision', async () => {
    const debug = vi.fn()
    const canUseTool = createClaudeCanUseToolPolicy({
      logger: { debug },
    })

    await expect(canUseTool('EnterPlanMode', {}, {})).resolves.toEqual({ updatedInput: {} })
    await expect(canUseTool('ExitPlanMode', {}, {})).resolves.toEqual({ updatedInput: {} })
    expect(debug).toHaveBeenCalledTimes(2)
  })

  it('auto-approves non-plan tools without plan-mode log', async () => {
    const debug = vi.fn()
    const canUseTool = createClaudeCanUseToolPolicy({
      logger: { debug },
    })

    await expect(canUseTool('Bash', {}, {})).resolves.toEqual({ updatedInput: {} })
    expect(debug).not.toHaveBeenCalled()
  })

  it('passes through the original tool input in updatedInput', async () => {
    const canUseTool = createClaudeCanUseToolPolicy()
    const toolInput = { allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] }

    const result = await canUseTool('ExitPlanMode', toolInput, {})
    expect(result).toEqual({ updatedInput: toolInput })
  })

  it('applies Claude session policy defaults and injects canUseTool', async () => {
    const debug = vi.fn()
    const options: Record<string, unknown> = {}

    applyClaudeSessionPolicy({
      options,
      logger: { debug },
    })

    expect(options.disallowedTools).toEqual(['AskUserQuestion'])
    const canUseTool = options.canUseTool as
      | ((toolName: string, input: Record<string, unknown>, options: unknown) => Promise<unknown>)
      | undefined
    expect(canUseTool).toBeTypeOf('function')
    await expect(canUseTool?.('EnterPlanMode', {}, {})).resolves.toEqual({ updatedInput: {} })
    expect(debug).toHaveBeenCalledTimes(1)
  })

  it('respects builtinToolsEnabled=false and preserves existing disallowed tools', () => {
    const options: Record<string, unknown> = {
      disallowedTools: ['Bash', 'AskUserQuestion'],
    }

    applyClaudeSessionPolicy({
      options,
      builtinToolsEnabled: false,
    })

    expect(options.tools).toEqual([])
    const disallowed = options.disallowedTools as string[]
    expect(disallowed).toContain('Bash')
    expect(disallowed).toContain('AskUserQuestion')
  })
})
