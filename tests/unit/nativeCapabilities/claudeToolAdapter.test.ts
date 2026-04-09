// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod/v4'
import { toClaudeToolDefinition } from '../../../electron/nativeCapabilities/claudeToolAdapter'
import type { NativeToolDescriptor } from '../../../electron/nativeCapabilities/types'

vi.mock('../../../electron/integrations/opencowSdkCompat', () => ({
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
}))

function makeDescriptor(execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })): NativeToolDescriptor {
  return {
    name: 'evose_run_agent',
    description: 'run agent',
    inputSchema: {
      app_id: z.string(),
      input: z.string(),
    },
    execute,
  }
}

describe('claudeToolAdapter', () => {
  it('maps tool-use metadata in extra into native execution context', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const descriptor = makeDescriptor(execute)
    const definition = toClaudeToolDefinition(descriptor) as unknown as {
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
    }

    const controller = new AbortController()
    await definition.handler(
      { app_id: 'app-1', input: 'hello' },
      {
        tool_use_id: 'tool-use-1',
        request_id: 'request-1',
        signal: controller.signal,
        deadlineAt: 12345,
      },
    )

    expect(execute).toHaveBeenCalledWith({
      args: { app_id: 'app-1', input: 'hello' },
      context: {
        signal: controller.signal,
        deadlineAt: 12345,
        engine: 'claude',
        toolUseId: 'tool-use-1',
        invocationId: 'request-1',
      },
    })
  })

  it('falls back invocationId to toolUseId when request id is absent', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const descriptor = makeDescriptor(execute)
    const definition = toClaudeToolDefinition(descriptor) as unknown as {
      handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
    }

    await definition.handler(
      { app_id: 'app-1', input: 'hello' },
      {
        toolUseId: 'tool-use-2',
      },
    )

    expect(execute).toHaveBeenCalledWith({
      args: { app_id: 'app-1', input: 'hello' },
      context: {
        signal: undefined,
        deadlineAt: undefined,
        engine: 'claude',
        toolUseId: 'tool-use-2',
        invocationId: 'tool-use-2',
      },
    })
  })
})
