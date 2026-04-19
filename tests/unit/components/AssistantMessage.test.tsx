// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  AssistantMessage,
  isCompactAssistantContent,
} from '../../../src/renderer/components/DetailPanel/SessionPanel/AssistantMessage'
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
  it('detects compact assistant content only for tool-only blocks', () => {
    expect(isCompactAssistantContent([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'README.md' } },
      { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' },
      { type: 'thinking', thinking: 'next step' },
    ])).toBe(true)

    expect(isCompactAssistantContent([
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'README.md' } },
    ])).toBe(false)
  })

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

  it('uses compact outer spacing for tool-only assistant messages', () => {
    const message = makeAssistantMessage([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'README.md' } },
    ])

    render(<AssistantMessage message={message} sessionId="session-1" />)

    expect(screen.getByTestId('block-tool_use').parentElement?.className).toContain('py-px')
  })

  it('uses compact outer spacing for mixed tool and thinking messages', () => {
    const message = makeAssistantMessage([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: 'README.md' } },
      { type: 'thinking', thinking: 'next step' },
      { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' },
    ])

    const { container } = render(<AssistantMessage message={message} sessionId="session-1" />)

    const root = container.querySelector('[data-msg-id="msg-1"][data-msg-role="assistant"]') as HTMLElement | null
    expect(root?.className).toContain('py-px')
    expect(root?.firstElementChild?.className ?? '').toContain('space-y-1')
  })

  it('keeps prose assistant messages on the regular vertical rhythm', () => {
    const message = makeAssistantMessage([
      { type: 'text', text: 'hello world' },
    ])

    render(<AssistantMessage message={message} sessionId="session-1" />)

    expect(screen.getByTestId('block-text').parentElement?.className).toContain('py-0.5')
  })
})
