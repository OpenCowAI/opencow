// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AssistantMessage } from '../../../src/renderer/components/DetailPanel/SessionPanel/AssistantMessage'
import { NativeCapabilityTools } from '../../../src/shared/nativeCapabilityToolNames'
import type { ManagedSessionMessage } from '../../../src/shared/types'

vi.mock('../../../src/renderer/components/DetailPanel/SessionPanel/ToolBatchCollapsible', () => ({
  ToolBatchCollapsible: ({ messages }: { messages: ManagedSessionMessage[] }) => (
    <div data-testid="tool-batch-collapsible">{messages.length}</div>
  ),
}))

vi.mock('../../../src/renderer/components/DetailPanel/SessionPanel/ContentBlockRenderer', () => ({
  ContentBlockRenderer: ({ block }: { block: any }) => (
    <div data-testid={`block-${block.type}`}>{block.type}</div>
  ),
}))

vi.mock('@/stores/commandStore', () => ({
  useCommandStore: () => null,
  selectStreamingMessage: () => null,
}))

function makeAssistantMessage(blocks: ManagedSessionMessage['content']): ManagedSessionMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: blocks,
    timestamp: Date.now(),
    isStreaming: false,
  }
}

describe('AssistantMessage', () => {
  it('keeps schedule propose tool segment expanded (not collapsed)', () => {
    const message = makeAssistantMessage([
      {
        type: 'tool_use',
        id: 'tu-1',
        name: NativeCapabilityTools.SCHEDULE_PROPOSE_OPERATION,
        input: { operations: [] },
      },
      {
        type: 'tool_result',
        toolUseId: 'tu-1',
        content: '[]',
      },
      {
        type: 'tool_use',
        id: 'tu-2',
        name: 'Read',
        input: { file_path: 'README.md' },
      },
      {
        type: 'tool_result',
        toolUseId: 'tu-2',
        content: 'ok',
      },
    ])

    render(<AssistantMessage message={message} sessionId="session-1" />)

    expect(screen.queryByTestId('tool-batch-collapsible')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('block-tool_use').length).toBe(2)
    expect(screen.getAllByTestId('block-tool_result').length).toBe(2)
  })
})

