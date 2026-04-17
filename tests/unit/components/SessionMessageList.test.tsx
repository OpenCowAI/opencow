// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SessionMessageList } from '../../../src/renderer/components/DetailPanel/SessionPanel/SessionMessageList'
import type { ManagedSessionMessage, ManagedSessionState, ContentBlock, SystemEvent } from '../../../src/shared/types'
import { resolveLatestSessionDraft } from '../../../src/shared/sessionDraftOutputParser'

const lifecycleHookMock = vi.hoisted(() => {
  return {
    latestPendingIssueOperation: null as any,
    latestPendingScheduleOperation: null as any,
    operations: [],
    loading: false,
    refreshing: false,
    refresh: vi.fn(async () => {}),
    confirm: vi.fn(async () => ({ ok: false, code: 'invalid_state', operation: null })),
    reject: vi.fn(async () => ({ ok: false, code: 'invalid_state', operation: null })),
  }
})

vi.mock('../../../src/shared/sessionDraftOutputParser', async () => {
  const actual = await vi.importActual<typeof import('../../../src/shared/sessionDraftOutputParser')>(
    '../../../src/shared/sessionDraftOutputParser'
  )
  return {
    ...actual,
    resolveLatestSessionDraft: vi.fn(actual.resolveLatestSessionDraft),
  }
})

vi.mock('@/hooks/useSessionLifecycleOperations', () => ({
  useSessionLifecycleOperations: () => lifecycleHookMock,
}))

// react-virtuoso's Virtuoso component requires real DOM dimensions to render items.
// In jsdom the container has 0 dimensions so items are never measured / rendered.
// Mock it with a simple pass-through renderer.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: any) => {
    const ListComp = components?.List
    const FooterComp = components?.Footer
    const list = data?.map((item: any, index: number) => (
      <div key={index}>{itemContent(index, item)}</div>
    ))
    const listNode = ListComp
      ? <ListComp role="list" aria-label="Session messages">{list}</ListComp>
      : <div role="list" aria-label="Session messages">{list}</div>

    return (
      <>
        {listNode}
        {FooterComp ? <FooterComp /> : null}
      </>
    )
  },
}))

function textBlocks(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function makeUserMsg(content: ContentBlock[], id = 'msg-1'): ManagedSessionMessage {
  return { id, role: 'user', content, timestamp: Date.now() }
}

function makeAssistantMsg(
  content: ContentBlock[],
  opts: { id?: string; isStreaming?: boolean; activeToolUseId?: string | null } = {}
): ManagedSessionMessage {
  return {
    id: opts.id ?? 'msg-1',
    role: 'assistant',
    content,
    timestamp: Date.now(),
    isStreaming: opts.isStreaming,
    activeToolUseId: opts.activeToolUseId
  }
}

function makeSystemMsg(event: SystemEvent, id = 'sys-1'): ManagedSessionMessage {
  return { id, role: 'system', event, timestamp: Date.now() }
}

describe('SessionMessageList', () => {
  beforeEach(() => {
    vi.mocked(resolveLatestSessionDraft).mockClear()
    lifecycleHookMock.latestPendingIssueOperation = null
    lifecycleHookMock.latestPendingScheduleOperation = null
  })

  function issueOutputText(title: string): string {
    return [
      '```issue-output',
      '---',
      `title: "${title}"`,
      'status: todo',
      'priority: medium',
      'labels: ["bug"]',
      '---',
      'issue description',
      '```',
    ].join('\n')
  }

  function scheduleOutputText(name: string): string {
    return [
      '```schedule-output',
      '---',
      `name: "${name}"`,
      'description: "weekly report"',
      'frequency: weekly',
      'timeOfDay: "10:30"',
      'daysOfWeek: [1, 3, 5]',
      'priority: high',
      '---',
      'run weekly report generation',
      '```',
    ].join('\n')
  }

  function mixedDraftText(issueTitle: string, scheduleName: string): string {
    return [
      scheduleOutputText(scheduleName),
      '',
      issueOutputText(issueTitle),
    ].join('\n')
  }

  it('renders user messages with ">" prefix', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeUserMsg(textBlocks('Fix the bug'))]}
      />
    )
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('>')).toBeInTheDocument()
  })

  it('renders assistant messages with markdown', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('I will **fix** this.'), { id: 'msg-2' })]}
      />
    )
    expect(screen.getByText('fix')).toBeInTheDocument()
    expect(screen.getByText('fix').tagName).toBe('STRONG')
  })

  it('renders user slash command with frozen label', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeUserMsg([
            {
              type: 'slash_command',
              name: 'evose:x_analyst_abcd12',
              category: 'skill',
              label: 'X Analyst',
              expandedText: 'Run app',
            },
            { type: 'text', text: ' summarize this topic' },
          ]),
        ]}
      />
    )
    expect(screen.getByText('/X Analyst')).toBeInTheDocument()
    expect(screen.queryByText('/evose:x_analyst_abcd12')).toBeNull()
  })

  it('shows streaming cursor for streaming assistant message', () => {
    const { container } = render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('Working on it'), { id: 'msg-3', isStreaming: true })]}
      />
    )
    expect(container.querySelector('.streaming-dots')).toBeInTheDocument()
  })

  it('hides streaming cursor when streaming assistant message contains tool calls', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Running checks...' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'npm run test' } },
    ]
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(blocks, { id: 'msg-stream-tool', isStreaming: true, activeToolUseId: 'tu-1' })]}
      />
    )
    expect(document.querySelector('.streaming-dots')).toBeNull()
  })

  it('does not show streaming cursor for completed message', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('Done.'), { id: 'msg-4' })]}
      />
    )
    expect(document.querySelector('.streaming-dots')).toBeNull()
  })

  it('removes streaming cursor when message updates in-place at same list length', () => {
    const { rerender, container } = render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('Working...'), { id: 'msg-inplace', isStreaming: true })]}
      />
    )
    expect(container.querySelector('.streaming-dots')).toBeInTheDocument()

    // Same message id, same list length — only isStreaming flips to false.
    rerender(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('Working...'), { id: 'msg-inplace', isStreaming: false })]}
      />
    )
    expect(container.querySelector('.streaming-dots')).toBeNull()
  })

  it('renders multiple messages in order', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeUserMsg(textBlocks('Hello'), 'msg-1'),
          makeAssistantMsg(textBlocks('Hi there'), { id: 'msg-2' }),
          makeUserMsg(textBlocks('Do it'), 'msg-3')
        ]}
      />
    )
    const list = screen.getByRole('list')
    expect(list.children).toHaveLength(3)
  })

  it('renders empty state when no messages', () => {
    render(<SessionMessageList sessionId="test-session" messages={[]} />)
    expect(screen.getByRole('list').children).toHaveLength(0)
  })

  it('does not render draft footer when sessionDraftFooterConfig is not provided', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks(issueOutputText('Issue without config')), { id: 'draft-issue-1' })]}
      />
    )

    expect(screen.queryByLabelText('Issue confirmation card')).toBeNull()
    expect(screen.queryByLabelText('Schedule confirmation card')).toBeNull()
  })

  it('renders issue draft footer only when sessionDraftFooterConfig is provided', async () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks(issueOutputText('Issue with config')), { id: 'draft-issue-2' })]}
        sessionDraftFooterConfig={{
          strategy: 'inline-fenced-draft',
          projectId: 'project-1',
          issueCreationMode: 'standalone',
        }}
      />
    )

    expect(vi.mocked(resolveLatestSessionDraft)).toHaveBeenCalled()
    expect(await screen.findByLabelText('Issue confirmation card')).toBeInTheDocument()
    expect(screen.queryByLabelText('Schedule confirmation card')).toBeNull()
  })

  it('renders schedule draft footer for schedule-output when config is provided', async () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks(scheduleOutputText('Weekly report schedule')), { id: 'draft-schedule-1' })]}
        sessionDraftFooterConfig={{
          strategy: 'inline-fenced-draft',
          projectId: 'project-1',
          issueCreationMode: 'standalone',
        }}
      />
    )

    expect(vi.mocked(resolveLatestSessionDraft)).toHaveBeenCalled()
    expect(await screen.findByLabelText('Schedule confirmation card')).toBeInTheDocument()
    expect(screen.queryByLabelText('Issue confirmation card')).toBeNull()
  })

  it('prefers the last fenced draft in one assistant message when both issue/schedule outputs exist', async () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks(mixedDraftText('Issue wins by order', 'Schedule first')), { id: 'draft-mixed-1' })]}
        sessionDraftFooterConfig={{
          strategy: 'inline-fenced-draft',
          projectId: 'project-1',
          issueCreationMode: 'standalone',
        }}
      />
    )

    expect(await screen.findByLabelText('Issue confirmation card')).toBeInTheDocument()
    expect(screen.queryByLabelText('Schedule confirmation card')).toBeNull()
  })

  it('renders draft card inline immediately after its assistant message', async () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks(issueOutputText('Inline placement issue')), { id: 'draft-inline-1' })]}
        sessionDraftFooterConfig={{
          strategy: 'inline-fenced-draft',
          projectId: 'project-1',
          issueCreationMode: 'standalone',
        }}
      />
    )

    const draftCard = await screen.findByLabelText('Issue confirmation card')
    const list = screen.getByRole('list', { name: 'Session messages' })
    const assistantMessageNode = list.querySelector<HTMLElement>('[data-msg-id="draft-inline-1"]')
    expect(assistantMessageNode).not.toBeNull()
    expect(list.contains(draftCard)).toBe(true)
    expect(draftCard.parentElement).toBe(assistantMessageNode?.parentElement)
    expect(
      assistantMessageNode!.compareDocumentPosition(draftCard) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('does not render legacy inline issue draft card when lifecycle source is enabled', async () => {
    lifecycleHookMock.latestPendingIssueOperation = {
      operationId: 'lop-issue-1',
      operationIndex: 0,
      entity: 'issue',
      action: 'create',
      confirmationMode: 'required',
      state: 'pending_confirmation',
      normalizedPayload: {
        title: 'Lifecycle issue draft',
        description: 'from lifecycle',
        status: 'todo',
        priority: 'medium',
        labels: ['ai'],
      },
      summary: {},
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appliedAt: null,
      resultSnapshot: null,
      errorCode: null,
      errorMessage: null,
    }

    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('assistant response without fenced draft'), { id: 'lifecycle-inline-1' })]}
        sessionDraftFooterConfig={{
          strategy: 'lifecycle-tool-result-only',
        }}
      />
    )

    expect(screen.queryByLabelText('Issue confirmation card')).toBeNull()
  })

  it('does not render legacy inline schedule draft card when lifecycle source is enabled', async () => {
    lifecycleHookMock.latestPendingScheduleOperation = {
      operationId: 'lop-schedule-1',
      operationIndex: 0,
      entity: 'schedule',
      action: 'create',
      confirmationMode: 'required',
      state: 'pending_confirmation',
      normalizedPayload: {
        name: 'Lifecycle schedule draft',
        description: 'from lifecycle',
        frequency: 'weekly',
        timeOfDay: '10:30',
        daysOfWeek: [1, 3, 5],
        priority: 'high',
      },
      summary: {},
      warnings: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appliedAt: null,
      resultSnapshot: null,
      errorCode: null,
      errorMessage: null,
    }

    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(textBlocks('assistant response without fenced schedule draft'), { id: 'lifecycle-schedule-inline-1' })]}
        sessionDraftFooterConfig={{
          strategy: 'lifecycle-tool-result-only',
        }}
      />
    )

    expect(screen.queryByLabelText('Schedule confirmation card')).toBeNull()
  })

  it('has aria-label on message list', () => {
    render(<SessionMessageList sessionId="test-session" messages={[]} />)
    expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Session messages')
  })

  it('renders assistant message with mixed content blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'I will read the file.' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/tmp/test.ts' } },
      { type: 'tool_result', toolUseId: 'tu-1', content: 'file contents here' },
      { type: 'text', text: 'Done reading.' }
    ]
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(blocks, { id: 'msg-5' })]}
      />
    )
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('file contents here')).toBeInTheDocument()
    expect(screen.getByText(/Done reading/)).toBeInTheDocument()
  })

  it('shows tool executing spinner on non-streaming assistant messages when activeToolUseId matches', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 'tu-1', name: 'WebSearch', input: { query: 'OpenClaw' } },
      { type: 'tool_result', toolUseId: 'tu-1', content: 'Search query: OpenClaw' },
    ]

    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(blocks, { id: 'msg-stale-active', isStreaming: false, activeToolUseId: 'tu-1' })]}
      />
    )

    // isExecuting is now decoupled from isMessageStreaming — spinner shows
    // whenever activeToolUseId matches the block id (e.g. MCP tools execute
    // after message finalization).
    expect(screen.getByLabelText('Tool executing')).toBeInTheDocument()
  })

  it('collapses in-message tool segments with 2+ tool calls', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'I am checking the project.' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'tu-1', content: '/workspace' },
      { type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'ls -la' } },
      { type: 'tool_result', toolUseId: 'tu-2', content: '...' },
    ]
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(blocks, { id: 'msg-tools', isStreaming: true, activeToolUseId: 'tu-2' })]}
      />
    )

    expect(screen.getByRole('button', { name: /Expand 2 tool calls/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Tool executing')).toBeNull()
  })

  it('does not collapse single-tool segments split by thinking blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'phase 1' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'pwd' } },
      { type: 'tool_result', toolUseId: 'tu-1', content: '/workspace' },
      { type: 'thinking', thinking: 'next step' },
      { type: 'tool_use', id: 'tu-2', name: 'Bash', input: { command: 'ls -la' } },
      { type: 'tool_result', toolUseId: 'tu-2', content: '...' },
    ]
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[makeAssistantMsg(blocks, { id: 'msg-tools-split' })]}
      />
    )

    expect(screen.queryByRole('button', { name: /Expand 1 tool calls/i })).toBeNull()
    expect(screen.getAllByText('Bash').length).toBeGreaterThanOrEqual(2)
  })

  // === System event rendering ===

  it('renders compact_boundary as a divider', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeUserMsg(textBlocks('Hello'), 'msg-1'),
          makeSystemMsg({ type: 'compact_boundary', trigger: 'auto', preTokens: 127000 }),
          makeUserMsg(textBlocks('World'), 'msg-2')
        ]}
      />
    )
    expect(screen.getByText(/Memory optimized/)).toBeInTheDocument()
    expect(screen.getByText(/127k/)).toBeInTheDocument()
  })

  it('renders task_started inline', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeSystemMsg({ type: 'task_started', taskId: 'task-1', description: 'Research SDK types' })
        ]}
      />
    )
    expect(screen.getByText(/Task started/)).toBeInTheDocument()
    expect(screen.getByText(/Research SDK types/)).toBeInTheDocument()
  })

  it('renders task_notification with status', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeSystemMsg({
            type: 'task_notification',
            taskId: 'task-1',
            status: 'completed',
            summary: 'Found 3 relevant files'
          })
        ]}
      />
    )
    expect(screen.getByText(/completed/i)).toBeInTheDocument()
    expect(screen.getByText(/Found 3 relevant files/)).toBeInTheDocument()
  })

  it('renders hook event inline', () => {
    render(
      <SessionMessageList
        sessionId="test-session"
        messages={[
          makeSystemMsg({
            type: 'hook',
            hookId: 'h-1',
            hookName: 'PreToolUse',
            hookTrigger: 'PreToolUse',
            outcome: 'success'
          })
        ]}
      />
    )
    expect(screen.getByText(/PreToolUse/)).toBeInTheDocument()
  })

  // === Turn-level "View Changes" visibility ===

  /**
   * Helper: build an assistant message containing a Write tool_use block,
   * which is the minimal trigger for turnDiffMap to register file changes.
   */
  function makeAssistantWithWrite(
    filePath: string,
    opts: { id?: string; isStreaming?: boolean } = {},
  ): ManagedSessionMessage {
    return makeAssistantMsg(
      [
        { type: 'text', text: 'Writing file...' },
        {
          type: 'tool_use',
          id: 'tu-write-1',
          name: 'Write',
          input: { file_path: filePath, content: 'hello' },
        },
      ],
      { id: opts.id ?? 'a-1', isStreaming: opts.isStreaming },
    )
  }

  /**
   * Build a standard two-turn conversation where the first turn has file
   * changes, enabling easy testing of historical vs current turn visibility.
   */
  function twoTurnMessages(): ManagedSessionMessage[] {
    return [
      makeUserMsg(textBlocks('Create a file'), 'u-1'),
      makeAssistantWithWrite('/tmp/one.ts', { id: 'a-1' }),
      makeUserMsg(textBlocks('Now create another'), 'u-2'),
      makeAssistantWithWrite('/tmp/two.ts', { id: 'a-2' }),
    ]
  }

  describe('turn View Changes — current turn visibility', () => {
    const settledStates: ManagedSessionState[] = ['idle', 'awaiting_input', 'stopped', 'error']
    const activeStates: ManagedSessionState[] = ['creating', 'streaming', 'stopping', 'awaiting_question']

    it.each(settledStates)(
      'shows View Changes for the current turn when sessionState is "%s"',
      (state) => {
        render(
          <SessionMessageList
            sessionId="test-session"
            sessionState={state}
            messages={[
              makeUserMsg(textBlocks('Create a file'), 'u-1'),
              makeAssistantWithWrite('/tmp/test.ts', { id: 'a-1' }),
            ]}
          />,
        )
        expect(screen.getByRole('button', { name: /View.*changed file/i })).toBeInTheDocument()
      },
    )

    it.each(activeStates)(
      'hides View Changes for the current turn when sessionState is "%s"',
      (state) => {
        render(
          <SessionMessageList
            sessionId="test-session"
            sessionState={state}
            messages={[
              makeUserMsg(textBlocks('Create a file'), 'u-1'),
              makeAssistantWithWrite('/tmp/test.ts', { id: 'a-1' }),
            ]}
          />,
        )
        expect(screen.queryByRole('button', { name: /View.*changed file/i })).toBeNull()
      },
    )

    it('shows View Changes for the current turn when sessionState is undefined (archived session)', () => {
      render(
        <SessionMessageList
          sessionId="test-session"
          messages={[
            makeUserMsg(textBlocks('Create a file'), 'u-1'),
            makeAssistantWithWrite('/tmp/test.ts', { id: 'a-1' }),
          ]}
        />,
      )
      expect(screen.getByRole('button', { name: /View.*changed file/i })).toBeInTheDocument()
    })
  })

  describe('turn View Changes — historical turn always visible', () => {
    it('shows View Changes for a historical turn even when session is streaming', () => {
      render(
        <SessionMessageList
          sessionId="test-session"
          sessionState="streaming"
          messages={twoTurnMessages()}
        />,
      )
      // Historical turn (first turn) should still show View Changes
      const buttons = screen.getAllByText('View Changes')
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })
  })
})
