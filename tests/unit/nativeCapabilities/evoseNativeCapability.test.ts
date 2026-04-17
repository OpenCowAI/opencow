// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvoseNativeCapability } from '../../../electron/nativeCapabilities/evose/evoseNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'
import type { OpenCowSessionContext } from '../../../electron/nativeCapabilities/openCowSessionContext'
import type { ToolProgressRelay } from '../../../electron/utils/toolProgressRelay'

interface EvoseCapabilityHarness {
  capability: EvoseNativeCapability
  runAgent: ReturnType<typeof vi.fn>
  runWorkflow: ReturnType<typeof vi.fn>
}

interface ContextHarness {
  context: NativeCapabilityToolContext
  sessionContext: OpenCowSessionContext
  relay: {
    register: ReturnType<typeof vi.fn>
    unregister: ReturnType<typeof vi.fn>
    emit: ReturnType<typeof vi.fn>
  }
}

/**
 * Phase 1B.11: relay now lives on `OpenCowSessionContext.relay` (per spike 3
 * — relay is OpenCow-internal infrastructure, not a generic SDK
 * HostEnvironment field). Tests construct a mock relay and embed it in the
 * sessionContext rather than passing it as a top-level field on the
 * NativeCapabilityToolContext.
 */
function createContextHarness(): ContextHarness {
  const relay = {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
    flush: vi.fn(),
  }
  const sessionContext: OpenCowSessionContext = {
    sessionId: 'session-evose-1',
    cwd: '/tmp',
    abortSignal: new AbortController().signal,
    projectId: null,
    issueId: null,
    originSource: 'agent',
    relay: relay as unknown as ToolProgressRelay,
  }
  return {
    context: {
      sessionContext,
      hostEnvironment: { activeMcpServerNames: [] },
    },
    sessionContext,
    relay,
  }
}

function createHarness(): EvoseCapabilityHarness {
  const runAgent = vi.fn().mockResolvedValue('agent result')
  const runWorkflow = vi.fn().mockResolvedValue('workflow result')
  const capability = new EvoseNativeCapability(
    {
      runAgent,
      runWorkflow,
    } as never,
    {
      getSettings: () => ({
        evose: {
          apiKey: 'evose-key',
          baseUrl: 'https://example-evose.test',
          workspaceIds: ['ws-1'],
          apps: [
            {
              appId: 'app-agent-1',
              name: 'Agent App',
              type: 'agent',
              enabled: true,
            },
            {
              appId: 'app-workflow-1',
              name: 'Workflow App',
              type: 'workflow',
              enabled: true,
            },
          ],
        },
      }),
    } as never,
  )

  return { capability, runAgent, runWorkflow }
}

/**
 * Phase 1B.11 helper: invoke a descriptor's execute with the new SDK shape.
 * The legacy `tool.execute({args, context: {...}})` signature is gone.
 */
async function executeTool(
  ctxHarness: ContextHarness,
  tool: { execute: (input: never) => Promise<unknown> },
  args: Record<string, unknown>,
  options: { abortSignal?: AbortSignal; toolUseId?: string } = {},
) {
  return (tool.execute as (input: {
    args: Record<string, unknown>
    sessionContext: OpenCowSessionContext
    toolUseId: string
    abortSignal: AbortSignal
  }) => Promise<unknown>)({
    args,
    sessionContext: ctxHarness.sessionContext,
    toolUseId: options.toolUseId ?? 'evose-test',
    abortSignal: options.abortSignal ?? new AbortController().signal,
  })
}

describe('EvoseNativeCapability cancellation propagation', () => {
  let harness: EvoseCapabilityHarness

  beforeEach(() => {
    harness = createHarness()
  })

  it('passes invocation signal into EvoseService.runAgent', async () => {
    const ctxH = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(ctxH.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const controller = new AbortController()
    const result = await executeTool(
      ctxH,
      agentTool,
      { app_id: 'app-agent-1', input: 'hello', session_id: 'thread-1' },
      { abortSignal: controller.signal, toolUseId: 'invocation-signal-1' },
    )

    expect(harness.runAgent).toHaveBeenCalledTimes(1)
    expect(harness.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-agent-1',
        input: 'hello',
        sessionId: 'thread-1',
        signal: controller.signal,
      }),
    )
    expect(result).toEqual({
      content: [{ type: 'text', text: 'agent result' }],
    })
  })

  it('passes invocation signal into EvoseService.runWorkflow', async () => {
    const ctxH = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(ctxH.context)
    const workflowTool = toolDescriptors.find((tool) => tool.name === 'evose_run_workflow')
    if (!workflowTool) throw new Error('Expected an Evose workflow tool descriptor')

    const controller = new AbortController()
    const result = await executeTool(
      ctxH,
      workflowTool,
      { app_id: 'app-workflow-1', inputs: { city: 'Shanghai' } },
      { abortSignal: controller.signal },
    )

    expect(harness.runWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.runWorkflow).toHaveBeenCalledWith({
      appId: 'app-workflow-1',
      inputs: { city: 'Shanghai' },
      signal: controller.signal,
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'workflow result' }],
    })
  })

  // ── Deterministic Relay Key ──────────────────────────────────────────────
  //
  // The relay key is ALWAYS derived via deriveEvoseRelayKey(toolName, appId).
  // It does NOT depend on SDK-provided toolUseId, because the MCP protocol
  // boundary strips tool_use_id from the handler's extra context.

  it('always uses deterministic relay key (toolName:appId), ignoring SDK context', async () => {
    harness.runAgent.mockImplementation(async (input: { onEvent?: (event: { type: string; text?: string }) => void }) => {
      input.onEvent?.({ type: 'output', text: 'stream text' })
      return 'agent result'
    })
    const ctxH = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(ctxH.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    // Even when SDK provides a toolUseId, the relay key is deterministic
    await executeTool(
      ctxH,
      agentTool,
      { app_id: 'app-agent-1', input: 'hello' },
      { toolUseId: 'tool-use-1' },
    )

    // Key is always `evose_run_agent:app-agent-1` — NEVER `tool-use-1`
    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(ctxH.relay.emit).toHaveBeenCalledWith(expectedKey, { type: 'text', text: 'stream text' })
    expect(ctxH.relay.unregister).toHaveBeenCalledWith(expectedKey)
  })

  it('uses deterministic relay key when SDK toolUseId is empty', async () => {
    harness.runAgent.mockImplementation(async (input: { onEvent?: (event: { type: string; text?: string }) => void }) => {
      input.onEvent?.({ type: 'output', text: 'stream text' })
      return 'agent result'
    })
    const ctxH = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(ctxH.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const result = await executeTool(
      ctxH,
      agentTool,
      { app_id: 'app-agent-1', input: 'hello' },
      { toolUseId: '' },
    )

    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(ctxH.relay.emit).toHaveBeenCalledWith(expectedKey, { type: 'text', text: 'stream text' })
    expect(ctxH.relay.unregister).toHaveBeenCalledWith(expectedKey)
    expect(harness.runAgent).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'agent result' }],
    })
  })

  it('unregisters relay on error path', async () => {
    harness.runAgent.mockRejectedValue(new Error('network failure'))
    const ctxH = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(ctxH.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const result = await executeTool(
      ctxH,
      agentTool,
      { app_id: 'app-agent-1', input: 'hello' },
    )

    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(ctxH.relay.unregister).toHaveBeenCalledWith(expectedKey)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: network failure' }],
      isError: true,
    })
  })
})
