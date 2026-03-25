// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import {
  groupMessages,
  isBatchableToolMessage,
  extractMdFiles,
  ToolBatchCollapsible
} from '../../../src/renderer/components/DetailPanel/SessionPanel/ToolBatchCollapsible'
import { ContentViewerProvider } from '../../../src/renderer/components/DetailPanel/SessionPanel/ContentViewerContext'
import { TaskEventsProvider } from '../../../src/renderer/components/DetailPanel/SessionPanel/TaskWidgets'
import { AskUserQuestionProvider } from '../../../src/renderer/components/DetailPanel/SessionPanel/AskUserQuestionWidgets'
import type { ManagedSessionMessage, ContentBlock } from '../../../src/shared/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  ;(window as any).opencow = {
    'view-tool-file-content': vi.fn().mockResolvedValue({
      ok: true,
      data: { content: '', language: 'plaintext', size: 0 },
    }),
    'download-file': vi.fn().mockResolvedValue(undefined),
  }
})

function makeToolOnlyMsg(
  toolName: string,
  id: string,
  opts: { isStreaming?: boolean } = {}
): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    content: [
      { type: 'tool_use', id: `tu-${id}`, name: toolName, input: { file_path: '/tmp/test.ts' } },
      { type: 'tool_result', toolUseId: `tu-${id}`, content: 'result output' }
    ],
    timestamp: Date.now(),
    isStreaming: opts.isStreaming
  }
}

function makeTextMsg(text: string, id: string): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: Date.now()
  }
}

function makeMixedMsg(text: string, toolName: string, id: string): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    content: [
      { type: 'text', text },
      { type: 'tool_use', id: `tu-${id}`, name: toolName, input: {} },
      { type: 'tool_result', toolUseId: `tu-${id}`, content: 'ok' }
    ],
    timestamp: Date.now()
  }
}

function makeUserMsg(text: string, id: string): ManagedSessionMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now()
  }
}

function makeSystemMsg(id: string): ManagedSessionMessage {
  return {
    id,
    role: 'system',
    event: { type: 'compact_boundary', trigger: 'auto', preTokens: 50000 },
    timestamp: Date.now()
  }
}

function makeWidgetToolMsg(toolName: string, id: string): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    content: [
      { type: 'tool_use', id: `tu-${id}`, name: toolName, input: { prompt: 'test' } },
      { type: 'tool_result', toolUseId: `tu-${id}`, content: 'done' }
    ],
    timestamp: Date.now()
  }
}

// ─── isBatchableToolMessage ─────────────────────────────────────────────────

describe('isBatchableToolMessage', () => {
  it('returns true for tool-only assistant messages', () => {
    expect(isBatchableToolMessage(makeToolOnlyMsg('Read', 'a1'))).toBe(true)
    expect(isBatchableToolMessage(makeToolOnlyMsg('Glob', 'a2'))).toBe(true)
    expect(isBatchableToolMessage(makeToolOnlyMsg('Grep', 'a3'))).toBe(true)
    expect(isBatchableToolMessage(makeToolOnlyMsg('Edit', 'a4'))).toBe(true)
    expect(isBatchableToolMessage(makeToolOnlyMsg('Bash', 'a5'))).toBe(true)
  })

  it('returns false for messages with visible text', () => {
    expect(isBatchableToolMessage(makeTextMsg('Hello', 'a1'))).toBe(false)
    expect(isBatchableToolMessage(makeMixedMsg('Analyzing...', 'Read', 'a2'))).toBe(false)
  })

  it('returns false for user messages', () => {
    expect(isBatchableToolMessage(makeUserMsg('Do something', 'u1'))).toBe(false)
  })

  it('returns false for system messages', () => {
    expect(isBatchableToolMessage(makeSystemMsg('s1'))).toBe(false)
  })

  it('returns false for streaming messages', () => {
    expect(isBatchableToolMessage(makeToolOnlyMsg('Read', 'a1', { isStreaming: true }))).toBe(false)
  })

  it('returns false for widget tool messages (Task, TodoWrite, AskUserQuestion)', () => {
    expect(isBatchableToolMessage(makeWidgetToolMsg('Task', 'a1'))).toBe(false)
    expect(isBatchableToolMessage(makeWidgetToolMsg('TodoWrite', 'a2'))).toBe(false)
    expect(isBatchableToolMessage(makeWidgetToolMsg('AskUserQuestion', 'a3'))).toBe(false)
  })

  it('returns false for Evose agent/workflow tool messages', () => {
    // Evose tools must always be visible (streaming cards), never collapsed into a batch
    expect(isBatchableToolMessage(
      makeToolOnlyMsg('mcp__opencow-capabilities__evose_run_agent', 'a1')
    )).toBe(false)
    expect(isBatchableToolMessage(
      makeToolOnlyMsg('mcp__opencow-capabilities__evose_run_workflow', 'a2')
    )).toBe(false)
    expect(isBatchableToolMessage(
      makeToolOnlyMsg('mcp__opencow-capabilities__evose_run_agent', 'a3')
    )).toBe(false)
  })

  it('returns false for assistant message with only empty text', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      timestamp: Date.now()
    }
    // No tool_use block → false
    expect(isBatchableToolMessage(msg)).toBe(false)
  })

  it('returns true for message with empty text + tool use', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: '' },
        { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ],
      timestamp: Date.now()
    }
    expect(isBatchableToolMessage(msg)).toBe(true)
  })
})

// ─── groupMessages ──────────────────────────────────────────────────────────

describe('groupMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('wraps non-batchable messages as singles', () => {
    const msgs = [
      makeUserMsg('Hello', 'u1'),
      makeTextMsg('Hi there', 'a1')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('single')
    expect(groups[1].type).toBe('single')
  })

  it('batches 2+ consecutive tool-only messages', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeToolOnlyMsg('Glob', 'a3')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('tool_batch')
    if (groups[0].type === 'tool_batch') {
      expect(groups[0].messages).toHaveLength(3)
    }
  })

  it('does NOT batch a single tool-only message', () => {
    const msgs = [makeToolOnlyMsg('Read', 'a1')]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('single')
  })

  it('breaks batch on non-batchable message', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeTextMsg('Analysis complete', 'a3'),
      makeToolOnlyMsg('Edit', 'a4'),
      makeToolOnlyMsg('Edit', 'a5')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(3)
    // First batch
    expect(groups[0].type).toBe('tool_batch')
    if (groups[0].type === 'tool_batch') {
      expect(groups[0].messages).toHaveLength(2)
    }
    // Text message (single)
    expect(groups[1].type).toBe('single')
    // Second batch
    expect(groups[2].type).toBe('tool_batch')
    if (groups[2].type === 'tool_batch') {
      expect(groups[2].messages).toHaveLength(2)
    }
  })

  it('user message breaks a tool batch', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeUserMsg('Stop', 'u1'),
      makeToolOnlyMsg('Edit', 'a3'),
      makeToolOnlyMsg('Edit', 'a4')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(3)
    expect(groups[0].type).toBe('tool_batch')
    expect(groups[1].type).toBe('single')
    expect(groups[2].type).toBe('tool_batch')
  })

  it('system event breaks a tool batch', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeSystemMsg('s1'),
      makeToolOnlyMsg('Edit', 'a3'),
      makeToolOnlyMsg('Edit', 'a4')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(3)
    expect(groups[0].type).toBe('tool_batch')
    expect(groups[1].type).toBe('single') // system event
    expect(groups[2].type).toBe('tool_batch')
  })

  it('widget tool messages (Task) break a batch', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeWidgetToolMsg('Task', 'a3'),
      makeToolOnlyMsg('Edit', 'a4'),
      makeToolOnlyMsg('Edit', 'a5')
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(3)
    expect(groups[0].type).toBe('tool_batch')
    expect(groups[1].type).toBe('single') // Task
    expect(groups[2].type).toBe('tool_batch')
  })

  it('Evose tool messages break a batch and are rendered as singles', () => {
    // Typical agentic scenario: Read → evose_agent → Edit, Evose cards must always be visible
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('mcp__opencow-capabilities__evose_run_agent', 'a2'),
      makeToolOnlyMsg('Edit', 'a3'),
      makeToolOnlyMsg('Edit', 'a4'),
    ]
    const groups = groupMessages(msgs)
    // Read alone → single (< MIN_BATCH_SIZE)
    // Evose → single (excluded)
    // Edit + Edit → tool_batch
    expect(groups.map(g => g.type)).toEqual(['single', 'single', 'tool_batch'])
  })

  it('Evose workflow messages are also excluded from batching', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeToolOnlyMsg('mcp__opencow-capabilities__evose_run_workflow', 'a3'),
      makeToolOnlyMsg('Edit', 'a4'),
      makeToolOnlyMsg('Edit', 'a5'),
    ]
    const groups = groupMessages(msgs)
    // Read + Grep → tool_batch
    // Evose workflow → single (excluded)
    // Edit + Edit → tool_batch
    expect(groups.map(g => g.type)).toEqual(['tool_batch', 'single', 'tool_batch'])
  })

  it('streaming message is not batched', () => {
    const msgs = [
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2', { isStreaming: true })
    ]
    const groups = groupMessages(msgs)
    // a1 alone → single (< MIN_BATCH_SIZE), a2 (streaming) → single
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('single')
    expect(groups[1].type).toBe('single')
  })

  it('handles a realistic complex sequence', () => {
    const msgs = [
      makeUserMsg('Help me optimize', 'u1'),
      makeMixedMsg('Let me analyze...', 'Glob', 'a1'),   // text + tool → single
      makeToolOnlyMsg('Read', 'a2'),                      // batch start
      makeToolOnlyMsg('Read', 'a3'),                      // batch
      makeToolOnlyMsg('Grep', 'a4'),                      // batch end
      makeWidgetToolMsg('Task', 'a5'),                    // single (widget)
      makeToolOnlyMsg('Edit', 'a6'),                      // batch start
      makeToolOnlyMsg('Edit', 'a7'),                      // batch end
      makeTextMsg('All done!', 'a8')                      // single (text)
    ]
    const groups = groupMessages(msgs)

    expect(groups.map(g => g.type)).toEqual([
      'single',      // user
      'single',      // mixed (text + Glob)
      'tool_batch',  // Read, Read, Grep
      'single',      // Task
      'tool_batch',  // Edit, Edit
      'single'       // "All done!"
    ])

    // Verify batch sizes
    const batch1 = groups[2]
    if (batch1.type === 'tool_batch') {
      expect(batch1.messages).toHaveLength(3)
    }
    const batch2 = groups[4]
    if (batch2.type === 'tool_batch') {
      expect(batch2.messages).toHaveLength(2)
    }
  })
})

// ─── extractMdFiles ─────────────────────────────────────────────────────────

describe('extractMdFiles', () => {
  it('returns empty array when no md files', () => {
    expect(extractMdFiles([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])).toEqual([])
  })

  it('extracts Write .md file', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/docs/README.md', content: '# Hello' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ],
      timestamp: Date.now()
    }
    const result = extractMdFiles([msg])
    expect(result).toHaveLength(1)
    expect(result[0].filePath).toBe('/docs/README.md')
    expect(result[0].content).toBe('# Hello')
  })

  it('extracts Edit .md file using new_string', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: '/docs/GUIDE.md', old_string: '# Old', new_string: '# New' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ],
      timestamp: Date.now()
    }
    const result = extractMdFiles([msg])
    expect(result).toHaveLength(1)
    expect(result[0].filePath).toBe('/docs/GUIDE.md')
    expect(result[0].content).toBe('# New')
    expect(result[0].needsLoad).not.toBe(true)
  })

  it('ignores non-.md files', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/src/app.ts', content: 'code' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ],
      timestamp: Date.now()
    }
    expect(extractMdFiles([msg])).toEqual([])
  })

  it('extracts multiple md files in order', () => {
    const msgs: ManagedSessionMessage[] = [
      {
        id: 'a1', role: 'assistant', timestamp: Date.now(),
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/docs/A.md', content: '# A' } },
          { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
        ]
      },
      {
        id: 'a2', role: 'assistant', timestamp: Date.now(),
        content: [
          { type: 'tool_use', id: 'tu-2', name: 'Read', input: { file_path: '/src/app.ts' } },
          { type: 'tool_result', toolUseId: 'tu-2', content: 'code' }
        ]
      },
      {
        id: 'a3', role: 'assistant', timestamp: Date.now(),
        content: [
          { type: 'tool_use', id: 'tu-3', name: 'Edit', input: { file_path: '/docs/B.md', old_string: 'x', new_string: '# B' } },
          { type: 'tool_result', toolUseId: 'tu-3', content: 'ok' }
        ]
      }
    ]
    const result = extractMdFiles(msgs)
    expect(result).toHaveLength(2)
    expect(result[0].filePath).toBe('/docs/A.md')
    expect(result[1].filePath).toBe('/docs/B.md')
  })

  it('adds lazy-load placeholder for Write .md without content', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1', role: 'assistant', timestamp: Date.now(),
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/docs/README.md' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ]
    }
    const result = extractMdFiles([msg])
    expect(result).toHaveLength(1)
    expect(result[0].filePath).toBe('/docs/README.md')
    expect(result[0].needsLoad).toBe(true)
    expect(result[0].content).toContain('click to load')
  })

  it('adds lazy-load placeholder for Edit .md without new_string', () => {
    const msg: ManagedSessionMessage = {
      id: 'a1', role: 'assistant', timestamp: Date.now(),
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: '/docs/README.md', old_string: 'x' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' }
      ]
    }
    const result = extractMdFiles([msg])
    expect(result).toHaveLength(1)
    expect(result[0].filePath).toBe('/docs/README.md')
    expect(result[0].needsLoad).toBe(true)
    expect(result[0].content).toContain('click to load')
  })
})

// ─── ToolBatchCollapsible (component) ───────────────────────────────────────

describe('ToolBatchCollapsible', () => {
  const emptyTaskMap = new Map()
  const emptyConsumedIds = new Set<string>()

  function renderBatch(messages: ManagedSessionMessage[]) {
    return render(
      <TaskEventsProvider value={emptyTaskMap}>
        <AskUserQuestionProvider value={null}>
          <ol>
            <ToolBatchCollapsible
              messages={messages}
              consumedTaskIds={emptyConsumedIds}
            />
          </ol>
        </AskUserQuestionProvider>
      </TaskEventsProvider>
    )
  }

  it('renders collapsed state with tool count', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2'),
      makeToolOnlyMsg('Edit', 'a3')
    ])

    // Should show "3 tool calls" summary
    expect(screen.getByText(/3 tool calls/)).toBeInTheDocument()
    expect(screen.getByText(/Read, Grep, Edit/)).toBeInTheDocument()
  })

  it('renders collapsed state with tool count (×N for duplicates)', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Read', 'a2'),
      makeToolOnlyMsg('Read', 'a3')
    ])

    expect(screen.getByText(/3 tool calls/)).toBeInTheDocument()
    expect(screen.getByText(/Read ×3/)).toBeInTheDocument()
  })

  it('does not show tool details when collapsed', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])

    // tool_result content should not be visible
    expect(screen.queryByText('result output')).not.toBeInTheDocument()
  })

  it('expands to show all messages on click', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])

    // Click to expand
    const toggle = screen.getByRole('button', { name: /Expand 2 tool calls/ })
    fireEvent.click(toggle)

    // Now tool details should be visible
    expect(screen.getAllByText('result output')).toHaveLength(2)
  })

  it('collapses again on second click', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])

    // Expand
    fireEvent.click(screen.getByRole('button', { name: /Expand 2 tool calls/ }))
    expect(screen.getAllByText('result output')).toHaveLength(2)

    // Collapse
    fireEvent.click(screen.getByRole('button', { name: /Collapse 2 tool calls/ }))
    expect(screen.queryByText('result output')).not.toBeInTheDocument()
  })

  it('shows error indicator when batch contains errors', () => {
    const msgs: ManagedSessionMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'exit 1' } },
          { type: 'tool_result', toolUseId: 'tu-1', content: 'command failed', isError: true }
        ],
        timestamp: Date.now()
      },
      makeToolOnlyMsg('Read', 'a2')
    ]

    renderBatch(msgs)
    expect(screen.getByLabelText('Contains errors')).toBeInTheDocument()
  })

  it('has proper aria-expanded attribute', () => {
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])

    const toggle = screen.getByRole('button', { name: /Expand 2 tool calls/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not render collapsible summary for a single tool call', () => {
    renderBatch([makeToolOnlyMsg('Read', 'a1')])

    expect(screen.queryByRole('button', { name: /Expand 1 tool/i })).toBeNull()
    expect(screen.queryByText(/1 tool call/)).toBeNull()
    expect(screen.getByText('result output')).toBeInTheDocument()
  })

  it('singular "tool call" for single-tool batch edge case', () => {
    // Edge case: if we ever allow batch size 1 in the future
    // For now MIN_BATCH_SIZE=2, but test the label logic
    renderBatch([
      makeToolOnlyMsg('Read', 'a1'),
      makeToolOnlyMsg('Grep', 'a2')
    ])

    // Should say "calls" (plural)
    expect(screen.getByText(/2 tool calls/)).toBeInTheDocument()
  })

  it('loads lazy markdown previews via session-scoped file viewer', async () => {
    const user = userEvent.setup()
    const viewToolFile = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        content: '# Loaded from disk',
        language: 'markdown',
        size: 18,
      },
    })
    ;(window as any).opencow['view-tool-file-content'] = viewToolFile

    const msg: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: Date.now(),
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/docs/README.md' } },
        { type: 'tool_result', toolUseId: 'tu-1', content: 'ok' },
      ],
    }
    const msg2 = makeToolOnlyMsg('Read', 'a2')

    render(
      <ContentViewerProvider>
        <TaskEventsProvider value={emptyTaskMap}>
          <AskUserQuestionProvider value={null}>
            <ol>
              <ToolBatchCollapsible messages={[msg, msg2]} sessionId="session-1" />
            </ol>
          </AskUserQuestionProvider>
        </TaskEventsProvider>
      </ContentViewerProvider>
    )

    await user.click(screen.getByRole('button', { name: /preview.*readme\.md/i }))
    await waitFor(() => {
      expect(viewToolFile).toHaveBeenCalledWith({
        sessionId: 'session-1',
        filePath: '/docs/README.md',
      })
    })
  })
})
