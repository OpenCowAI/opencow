// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ContentBlockRenderer } from '../../../src/renderer/components/DetailPanel/SessionPanel/ContentBlockRenderer'
import type { ContentBlock } from '../../../src/shared/types'

describe('ContentBlockRenderer', () => {
  it('renders TextBlock via MarkdownContent', () => {
    const block: ContentBlock = { type: 'text', text: 'Hello **world**' }
    render(<ContentBlockRenderer block={block} />)
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('renders streaming cursor on last text block', () => {
    const block: ContentBlock = { type: 'text', text: 'Streaming' }
    const { container } = render(
      <ContentBlockRenderer block={block} isLastTextBlock isStreaming />
    )
    expect(container.querySelector('.streaming-dots')).toBeInTheDocument()
  })

  it('does not render streaming cursor when not last text block', () => {
    const block: ContentBlock = { type: 'text', text: 'Not last' }
    const { container } = render(
      <ContentBlockRenderer block={block} isLastTextBlock={false} isStreaming />
    )
    expect(container.querySelector('.streaming-dots')).not.toBeInTheDocument()
  })

  it('renders ToolUseBlock with name', () => {
    const block: ContentBlock = {
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls -la' }
    }
    render(<ContentBlockRenderer block={block} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
  })

  it('renders ToolUseBlock with spinner when executing', () => {
    const block: ContentBlock = {
      type: 'tool_use',
      id: 'tu-1',
      name: 'Read',
      input: { file_path: '/tmp/test.ts' }
    }
    render(
      <ContentBlockRenderer block={block} activeToolUseId="tu-1" isMessageStreaming />
    )
    expect(screen.getByLabelText('Tool executing')).toBeInTheDocument()
  })

  it('renders ToolUse spinner even when message is not streaming (MCP tool support)', () => {
    const block: ContentBlock = {
      type: 'tool_use',
      id: 'tu-1',
      name: 'Read',
      input: { file_path: '/tmp/test.ts' }
    }
    render(
      <ContentBlockRenderer block={block} activeToolUseId="tu-1" isMessageStreaming={false} />
    )
    // isExecuting is now decoupled from isMessageStreaming — spinner shows
    // whenever activeToolUseId matches block.id (MCP tools execute after
    // message finalization, so gating on isMessageStreaming would hide them).
    expect(screen.getByLabelText('Tool executing')).toBeInTheDocument()
  })

  it('renders ToolResultBlock content', () => {
    const block: ContentBlock = {
      type: 'tool_result',
      toolUseId: 'tu-1',
      content: 'file contents here'
    }
    const { container } = render(<ContentBlockRenderer block={block} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByText('file contents here')).not.toBeInTheDocument()
  })

  it('renders slash_command with frozen label instead of canonical name', () => {
    const block: ContentBlock = {
      type: 'slash_command',
      name: 'evose:x_analyst_abcd12',
      category: 'skill',
      label: 'X Analyst',
      expandedText: 'Run Evose app',
    }
    render(<ContentBlockRenderer block={block} />)
    expect(screen.getByText('/X Analyst')).toBeInTheDocument()
    expect(screen.queryByText('/evose:x_analyst_abcd12')).toBeNull()
  })

  it('renders ThinkingBlock collapsed by default', () => {
    const block: ContentBlock = {
      type: 'thinking',
      thinking: 'Let me analyze this problem'
    }
    render(<ContentBlockRenderer block={block} />)
    expect(screen.getByText(/thinking/i)).toBeInTheDocument()
    // Thinking text should NOT be visible when collapsed
    expect(screen.queryByText('Let me analyze this problem')).not.toBeInTheDocument()
  })

  it('renders nothing for unknown block type', () => {
    const block = { type: 'unknown' } as unknown as ContentBlock
    const { container } = render(<ContentBlockRenderer block={block} />)
    expect(container.innerHTML).toBe('')
  })
})
