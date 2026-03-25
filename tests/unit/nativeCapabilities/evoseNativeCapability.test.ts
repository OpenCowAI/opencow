// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EvoseNativeCapability } from '../../../electron/nativeCapabilities/evose/evoseNativeCapability'
import type { NativeCapabilityToolContext } from '../../../electron/nativeCapabilities/types'

interface EvoseCapabilityHarness {
  capability: EvoseNativeCapability
  runAgent: ReturnType<typeof vi.fn>
  runWorkflow: ReturnType<typeof vi.fn>
}

interface ContextHarness {
  context: NativeCapabilityToolContext
  relay: {
    register: ReturnType<typeof vi.fn>
    unregister: ReturnType<typeof vi.fn>
    emit: ReturnType<typeof vi.fn>
  }
}

function createContextHarness(): ContextHarness {
  const relay = {
    register: vi.fn(),
    unregister: vi.fn(),
    emit: vi.fn(),
  }
  return {
    context: {
      session: {
        sessionId: 'session-evose-1',
        projectId: null,
        originSource: 'agent',
      },
      relay: relay as unknown as NativeCapabilityToolContext['relay'],
    },
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

describe('EvoseNativeCapability cancellation propagation', () => {
  let harness: EvoseCapabilityHarness

  beforeEach(() => {
    harness = createHarness()
  })

  it('passes invocation signal into EvoseService.runAgent', async () => {
    const contextHarness = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(contextHarness.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const controller = new AbortController()
    const result = await agentTool.execute({
      args: { app_id: 'app-agent-1', input: 'hello', session_id: 'thread-1' },
      context: { signal: controller.signal, invocationId: 'invocation-signal-1' },
    })

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
    const contextHarness = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(contextHarness.context)
    const workflowTool = toolDescriptors.find((tool) => tool.name === 'evose_run_workflow')
    if (!workflowTool) throw new Error('Expected an Evose workflow tool descriptor')

    const controller = new AbortController()
    const result = await workflowTool.execute({
      args: { app_id: 'app-workflow-1', inputs: { city: 'Shanghai' } },
      context: { signal: controller.signal },
    })

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
  // It does NOT depend on SDK-provided toolUseId/invocationId, because the
  // MCP protocol boundary strips tool_use_id from the handler's extra context.

  it('always uses deterministic relay key (toolName:appId), ignoring SDK context', async () => {
    harness.runAgent.mockImplementation(async (input: { onEvent?: (event: { type: string; text?: string }) => void }) => {
      input.onEvent?.({ type: 'output', text: 'stream text' })
      return 'agent result'
    })
    const contextHarness = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(contextHarness.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    // Even when SDK provides toolUseId + invocationId, the relay key is deterministic
    await agentTool.execute({
      args: { app_id: 'app-agent-1', input: 'hello' },
      context: { toolUseId: 'tool-use-1', invocationId: 'invocation-1' },
    })

    // Key is always `evose_run_agent:app-agent-1` — NEVER `tool-use-1`
    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(contextHarness.relay.emit).toHaveBeenCalledWith(expectedKey, { type: 'text', text: 'stream text' })
    expect(contextHarness.relay.unregister).toHaveBeenCalledWith(expectedKey)
  })

  it('uses deterministic relay key when SDK context is empty', async () => {
    harness.runAgent.mockImplementation(async (input: { onEvent?: (event: { type: string; text?: string }) => void }) => {
      input.onEvent?.({ type: 'output', text: 'stream text' })
      return 'agent result'
    })
    const contextHarness = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(contextHarness.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const result = await agentTool.execute({
      args: { app_id: 'app-agent-1', input: 'hello' },
      context: {},
    })

    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(contextHarness.relay.emit).toHaveBeenCalledWith(expectedKey, { type: 'text', text: 'stream text' })
    expect(contextHarness.relay.unregister).toHaveBeenCalledWith(expectedKey)
    expect(harness.runAgent).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'agent result' }],
    })
  })

  it('unregisters relay on error path', async () => {
    harness.runAgent.mockRejectedValue(new Error('network failure'))
    const contextHarness = createContextHarness()
    const toolDescriptors = harness.capability.getToolDescriptors(contextHarness.context)
    const agentTool = toolDescriptors.find((tool) => tool.name === 'evose_run_agent')
    if (!agentTool) throw new Error('Expected an Evose agent tool descriptor')

    const result = await agentTool.execute({
      args: { app_id: 'app-agent-1', input: 'hello' },
      context: {},
    })

    const expectedKey = 'evose_run_agent:app-agent-1'
    expect(contextHarness.relay.unregister).toHaveBeenCalledWith(expectedKey)
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: network failure' }],
      isError: true,
    })
  })
})
