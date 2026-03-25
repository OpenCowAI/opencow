// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { MessageFormatter } from '../../../../electron/services/telegramBot/messageFormatter'

describe('MessageFormatter', () => {
  const fmt = new MessageFormatter()

  // ── Basic message formatting ────────────────────────────────────────────────

  it('formats status message with session list', () => {
    const result = fmt.statusMessage([
      { id: 's1', name: 'Fix bug', state: 'streaming', activity: 'Editing auth.ts' },
      { id: 's2', name: 'Refactor', state: 'awaiting_input', activity: null },
    ])
    expect(result.text).toContain('Fix bug')
    expect(result.text).toContain('Refactor')
    expect(result.text).toContain('OpenCow')
  })

  it('formats empty status', () => {
    const result = fmt.statusMessage([])
    expect(result.text).toContain('No active sessions')
  })

  it('formats error message', () => {
    const result = fmt.errorMessage({
      sessionId: 'sess-abc',
      sessionName: 'Crash',
      error: 'Spawn failed',
    })
    expect(result.text).toContain('Crash')
    expect(result.text).toContain('Spawn failed')
  })

  it('formats help message: uses HTML, text contains title, inline keyboard covers four groups', () => {
    const result = fmt.helpMessage()

    // Basic format
    expect(result.parse_mode).toBe('HTML')
    expect(result.text).toContain('OpenCow')

    // Assert inline keyboard structure
    type ButtonRow = Array<{ text: string; callback_data?: string }>
    const markup = result.reply_markup as { inline_keyboard: ButtonRow[] }
    const allButtons = markup.inline_keyboard.flat()
    const callbacks = allButtons.map((b) => b.callback_data).filter(Boolean)

    // ── Group 1: Chat buttons ────────────────────────────────────────────────
    expect(callbacks).toContain('cmd:new')
    expect(callbacks).toContain('cmd:clear')
    expect(callbacks).toContain('cmd:stop')

    // ── Group 2: Issues buttons ──────────────────────────────────────────────
    expect(callbacks.some((c) => c!.startsWith('cmd:issues'))).toBe(true)

    // ── Group 3: Projects buttons ────────────────────────────────────────────
    expect(callbacks.some((c) => c!.startsWith('cmd:projects'))).toBe(true)

    // ── Group 4: Other buttons ──────────────────────────────────────────────
    expect(callbacks).toContain('cmd:status')

    // Group header rows (noop) should appear at least 4 times (one per group)
    const noopCount = callbacks.filter((c) => c === 'noop').length
    expect(noopCount).toBeGreaterThanOrEqual(4)
  })

  it('escapeMd correctly escapes MarkdownV2 special characters', () => {
    const result = fmt.escapeMd('hello_world [test](link)')
    expect(result).toBe('hello\\_world \\[test\\]\\(link\\)')
  })

  // ── sessionDoneMessage (Task 6) ─────────────────────────────────────────────

  it('sessionDoneMessage normal completion: contains checkmark, completed text, uses HTML mode', () => {
    const result = fmt.sessionDoneMessage()
    expect(result.text).toContain('✅')
    expect(result.text).toContain('complete')
    expect(result.parse_mode).toBe('HTML')
  })

  it('sessionDoneMessage max_tokens: contains warning emoji and token limit truncation warning', () => {
    const result = fmt.sessionDoneMessage('max_tokens')
    expect(result.text).toContain('⚠️')
    expect(result.text).toContain('token limit')
  })

  it('sessionDoneMessage includes cmd:new inline button (exact callback_data match)', () => {
    const result = fmt.sessionDoneMessage()
    const markup = result.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
    }
    expect(markup).toBeDefined()
    expect(markup.inline_keyboard[0][0].callback_data).toBe('cmd:new')
    expect(markup.inline_keyboard[0][0].text).toContain('New Topic')
  })

  it('sessionDoneMessage end_turn does not show truncation warning', () => {
    const result = fmt.sessionDoneMessage('end_turn')
    expect(result.text).not.toContain('⚠️')
    expect(result.text).not.toContain('truncated')
  })

  // ── streamingPlaceholder (Task 8) ──────────────────────────────────────────

  it('streamingPlaceholder tool-active mode (no text): shows gear emoji and tool name', () => {
    const result = fmt.streamingPlaceholder('', 'Bash')
    expect(result).toContain('⚙️')
    expect(result).toContain('Bash')
    // Tool-active mode does not show text streaming header
    expect(result).not.toContain('⚡')
  })

  it('streamingPlaceholder text streaming mode: shows lightning header and strips Markdown syntax', () => {
    const result = fmt.streamingPlaceholder('**Hello** _world_')
    expect(result).toContain('⚡')
    // Markdown syntax is stripped, only plain text remains
    expect(result).toContain('Hello world')
    expect(result).not.toContain('**')
    expect(result).not.toContain('_Hello_')
  })

  it('streamingPlaceholder escapes HTML < and > to prevent XSS or breaking Telegram HTML parsing', () => {
    const result = fmt.streamingPlaceholder('<script>alert("xss")</script>')
    // Raw tags should not appear directly in output
    expect(result).not.toContain('<script>')
    // Should be escaped as HTML entities
    expect(result).toContain('&lt;script&gt;')
  })

  it('streamingPlaceholder tool-active + partial text: shows both tool name and text preview', () => {
    const result = fmt.streamingPlaceholder('Analyzing the codebase...', 'Read')
    expect(result).toContain('⚙️')
    expect(result).toContain('Read')
    // Preview should also appear when text is present
    expect(result).toContain('Analyzing')
  })

  it('streamingPlaceholder truncates and adds ellipsis when exceeding 300 characters', () => {
    const longText = 'A'.repeat(400)
    const result = fmt.streamingPlaceholder(longText)
    // Preview should be truncated
    expect(result).toContain('…')
    // Should not contain the full 400-character string
    expect(result.length).toBeLessThan(400)
  })

  // ── formatAssistantBlocks — blockquote expandable (Task 7) ────────────────

  it('long blockquote (> 6 lines) uses <blockquote expandable>', () => {
    // 7-line quote — exceeds collapsing threshold
    const longQuote = Array.from({ length: 7 }, (_, i) => `> Line ${i + 1}`).join('\n')
    const result = fmt.formatAssistantBlocks([{ type: 'text', text: longQuote }])
    expect(result[0]).toContain('<blockquote expandable>')
  })

  it('short blockquote (≤ 6 lines) uses plain <blockquote> without expandable', () => {
    // 4-line quote — within collapsing threshold
    const shortQuote = Array.from({ length: 4 }, (_, i) => `> Line ${i + 1}`).join('\n')
    const result = fmt.formatAssistantBlocks([{ type: 'text', text: shortQuote }])
    expect(result[0]).toContain('<blockquote>')
    expect(result[0]).not.toContain('expandable')
  })

  it('exactly 6-line blockquote does not trigger expandable', () => {
    const exactSixQuote = Array.from({ length: 6 }, (_, i) => `> Line ${i + 1}`).join('\n')
    const result = fmt.formatAssistantBlocks([{ type: 'text', text: exactSixQuote }])
    expect(result[0]).toContain('<blockquote>')
    expect(result[0]).not.toContain('expandable')
  })

  // ── formatAssistantBlocks — ToolUseBlock compact summary (Task 4) ─────────

  it('Bash ToolUseBlock: shows laptop emoji + tool name + command content', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la /tmp' } },
    ])
    expect(result[0]).toContain('💻')
    expect(result[0]).toContain('<b>Bash</b>')
    expect(result[0]).toContain('ls -la /tmp')
  })

  it('Read ToolUseBlock: shows book emoji and file path', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/src/main.ts' } },
    ])
    expect(result[0]).toContain('📖')
    expect(result[0]).toContain('/src/main.ts')
  })

  it('WebSearch ToolUseBlock: shows search emoji and search keywords', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'tool_use', id: 't3', name: 'WebSearch', input: { query: 'TypeScript generics' } },
    ])
    expect(result[0]).toContain('🔍')
    expect(result[0]).toContain('TypeScript generics')
  })

  it('unknown tool name falls back to gear emoji', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'tool_use', id: 't4', name: 'CustomTool', input: { key: 'value' } },
    ])
    expect(result[0]).toContain('⚙️')
    expect(result[0]).toContain('CustomTool')
  })

  it('formatAssistantBlocks merges mixed TextBlock and ToolUseBlock into a single message', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'text', text: 'I will read a file to check the implementation.' },
      { type: 'tool_use', id: 't5', name: 'Read', input: { file_path: '/src/index.ts' } },
    ])
    // Both content types are merged into one message block (when under 4096 chars)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('I will read a file')
    expect(result[0]).toContain('📖')
    expect(result[0]).toContain('/src/index.ts')
  })

  it('formatAssistantBlocks skips non-display blocks like tool_result / image', () => {
    const result = fmt.formatAssistantBlocks([
      // tool_result is an internal detail and should not be rendered to the user
      { type: 'tool_result', tool_use_id: 'x', content: 'internal result' } as any,
      { type: 'text', text: 'Only this text should appear' },
    ])
    expect(result[0]).toContain('Only this text should appear')
    expect(result[0]).not.toContain('internal result')
  })

  it('formatAssistantBlocks returns empty array when all blocks are non-text', () => {
    const result = fmt.formatAssistantBlocks([
      { type: 'tool_result', tool_use_id: 'x', content: 'result' } as any,
    ])
    expect(result).toHaveLength(0)
  })

  // ── extractEvoseActivity — text block extraction ────────────────────────

  describe('extractEvoseActivity', () => {
    it('extracts tool_call and text blocks', () => {
      const result = fmt.extractEvoseActivity([
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-x-analyst' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-1', toolName: 'web_search', title: 'Web Search', status: 'completed' as const },
            { type: 'text', text: 'Based on my analysis...' },
          ],
        },
      ])

      expect(result).not.toBeNull()
      expect(result!.agentName).toBe('Evose Agent (agent-x-analyst)')
      expect(result!.toolCalls).toHaveLength(1)
      expect(result!.textBlocks).toHaveLength(1)
      expect(result!.textBlocks[0].text).toBe('Based on my analysis...')
    })

    it('extracts text-only blocks (no tool_call)', () => {
      const result = fmt.extractEvoseActivity([
        {
          type: 'tool_use',
          id: 'tu-2',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-researcher' },
          progressBlocks: [
            { type: 'text', text: 'Here is my response...' },
          ],
        },
      ])

      expect(result).not.toBeNull()
      expect(result!.toolCalls).toHaveLength(0)
      expect(result!.textBlocks).toHaveLength(1)
    })

    it('returns null when progressBlocks is empty', () => {
      const result = fmt.extractEvoseActivity([
        {
          type: 'tool_use',
          id: 'tu-3',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-foo' },
          progressBlocks: [],
        },
      ])
      expect(result).toBeNull()
    })
  })

  // ── evoseActivityPlaceholder — text rendering ──────────────────────────────

  describe('evoseActivityPlaceholder', () => {
    it('includes tool call status and text preview', () => {
      const result = fmt.evoseActivityPlaceholder({
        agentName: 'X Analyst',
        toolCalls: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Web Search', status: 'completed' as const },
        ],
        textBlocks: [
          { type: 'text', text: 'The analysis shows significant growth.' },
        ],
      })

      expect(result).toContain('X Analyst')
      expect(result).toContain('✅')
      expect(result).toContain('Web Search')
      expect(result).toContain('significant growth')
    })

    it('shows only tool calls when there is no text', () => {
      const result = fmt.evoseActivityPlaceholder({
        agentName: 'Researcher',
        toolCalls: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Searching', status: 'running' as const },
        ],
        textBlocks: [],
      })

      expect(result).toContain('🔄')
      expect(result).toContain('Searching...')
    })
  })

  // ── formatEvoseSummary — final summary retention ────────────────────────────

  describe('formatEvoseSummary', () => {
    it('generates rich summary containing tool calls and text', () => {
      const result = fmt.formatEvoseSummary({
        type: 'tool_use',
        id: 'tu-1',
        name: 'mcp__opencow-capabilities__evose_run_agent',
        input: { app_id: 'agent-x-analyst' },
        progressBlocks: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Twitter Search', status: 'completed' as const },
          { type: 'tool_call', toolCallId: 'tc-2', toolName: 'analyze', title: 'Content Analysis', status: 'completed' as const },
          { type: 'text', text: 'Key findings: market is growing 30% YoY.' },
        ],
      })

      expect(result).not.toBeNull()
      expect(result).toContain('Evose Agent (agent-x-analyst)')
      expect(result).toContain('✅')
      expect(result).toContain('Twitter Search')
      expect(result).toContain('Content Analysis')
      expect(result).toContain('market is growing')
    })

    it('returns null when there are no progressBlocks', () => {
      const result = fmt.formatEvoseSummary({
        type: 'tool_use',
        id: 'tu-2',
        name: 'Bash',
        input: { command: 'ls' },
      })

      expect(result).toBeNull()
    })

    it('formatAssistantBlocks uses rich summary for Evose tools', () => {
      const result = fmt.formatAssistantBlocks([
        {
          type: 'tool_use',
          id: 'tu-3',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-researcher' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Deep Research', status: 'completed' as const },
            { type: 'text', text: 'Research complete. The data indicates...' },
          ],
        },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]).toContain('Evose Agent (agent-researcher)')
      expect(result[0]).toContain('Deep Research')
      expect(result[0]).toContain('data indicates')
    })

    it('formatAssistantBlocks still uses compact summary for regular tools', () => {
      const result = fmt.formatAssistantBlocks([
        { type: 'tool_use', id: 'tu-4', name: 'Bash', input: { command: 'ls -la' } },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]).toContain('💻')
      expect(result[0]).toContain('ls -la')
      expect(result[0]).not.toContain('⚙️')
    })
  })

  // ── evoseActivityPlaceholder — long text dedup freeze fix ────────────────

  describe('evoseActivityPlaceholder — long text does not freeze', () => {
    it('output includes total character count when text exceeds MAX_TEXT_LEN, enabling dedup', () => {
      const longText = 'A'.repeat(1200) // > 800 chars (MAX_TEXT_LEN)

      const result = fmt.evoseActivityPlaceholder({
        agentName: 'Writer',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: longText }],
      })

      // Output should contain truncation marker and character count
      expect(result).toContain('…')
      expect(result).toContain('1200 chars generated')
    })

    it('output changes as text grows (not skipped by dedup)', () => {
      const result1 = fmt.evoseActivityPlaceholder({
        agentName: 'Writer',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: 'A'.repeat(1000) }],
      })

      const result2 = fmt.evoseActivityPlaceholder({
        agentName: 'Writer',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: 'A'.repeat(1500) }],
      })

      // Two outputs differ (different char counts break dedup)
      expect(result1).not.toBe(result2)
      expect(result1).toContain('1000 chars generated')
      expect(result2).toContain('1500 chars generated')
    })

    it('does not show character count when text is under MAX_TEXT_LEN', () => {
      const result = fmt.evoseActivityPlaceholder({
        agentName: 'Helper',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: 'Short reply' }],
      })

      expect(result).not.toContain('chars generated')
      expect(result).toContain('Short reply')
    })

    it('total output does not exceed the 4000-character safety limit', () => {
      // Create a scenario with max tool calls + long text
      const toolCalls = Array.from({ length: 10 }, (_, i) => ({
        type: 'tool_call' as const,
        toolCallId: `tc-${i}`,
        toolName: 'very_long_tool_name_that_is_really_descriptive',
        title: 'A Very Long Tool Title That Takes Up Space In The Output',
        status: 'completed' as const,
        kwargs: { query: 'A'.repeat(80) },
      }))

      const result = fmt.evoseActivityPlaceholder({
        agentName: 'Super Long Agent Name That Is Quite Descriptive',
        toolCalls,
        textBlocks: [{ type: 'text', text: 'B'.repeat(2000) }],
      })

      expect(result.length).toBeLessThanOrEqual(4000)
    })
  })

  // ── evoseCommitHtml — full commit HTML ──────────────────────────────────

  describe('evoseCommitHtml', () => {
    it('short content is fully preserved without truncation', () => {
      const result = fmt.evoseCommitHtml({
        agentName: 'X Analyst',
        toolCalls: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Web Search', status: 'completed' as const },
        ],
        textBlocks: [
          { type: 'text', text: 'Short analysis result.' },
        ],
      })

      expect(result).toContain('X Analyst')
      expect(result).toContain('✅')
      expect(result).toContain('Web Search')
      expect(result).toContain('Short analysis result.')
    })

    it('long content is not truncated (caller is responsible for chunking)', () => {
      const longText = 'A'.repeat(5000)
      const result = fmt.evoseCommitHtml({
        agentName: 'Writer',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: longText }],
      })

      // Full text is preserved (not truncated to 800 or 4000)
      expect(result.length).toBeGreaterThan(4500)
      // Should not contain truncation indicators like "generated X chars" or "total X chars"
      expect(result).not.toContain('chars generated')
      expect(result).not.toContain('chars total')
    })

    it('converts Markdown to Telegram HTML', () => {
      const result = fmt.evoseCommitHtml({
        agentName: 'Formatter',
        toolCalls: [],
        textBlocks: [{ type: 'text', text: '**bold** and *italic* and `code`' }],
      })

      expect(result).toContain('<b>bold</b>')
      expect(result).toContain('<i>italic</i>')
      expect(result).toContain('<code>code</code>')
    })

    it('header does not contain "executing" text', () => {
      const result = fmt.evoseCommitHtml({
        agentName: 'Researcher',
        toolCalls: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'search', title: 'Search', status: 'running' as const },
        ],
      })

      expect(result).toContain('Researcher')
      expect(result).not.toContain('is running')
    })

    it('shows at most 8 tool calls', () => {
      const toolCalls = Array.from({ length: 10 }, (_, i) => ({
        type: 'tool_call' as const,
        toolCallId: `tc-${i}`,
        toolName: 'tool',
        title: `Step ${i}`,
        status: 'completed' as const,
      }))

      const result = fmt.evoseCommitHtml({
        agentName: 'Agent',
        toolCalls,
      })

      // Last 8 are visible (Step 2 through Step 9)
      expect(result).toContain('Step 9')
      expect(result).toContain('Step 2')
      // First 2 are hidden
      expect(result).toContain('and 2 more')
      expect(result).not.toContain('Step 0')
      expect(result).not.toContain('Step 1')
    })
  })

  // ── splitForTelegram ──────────────────────────────────────────────────

  describe('splitForTelegram', () => {
    it('short content returns a single chunk', () => {
      const result = fmt.splitForTelegram('Hello world')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('Hello world')
    })

    it('long content is split into multiple chunks (each ≤ 4096)', () => {
      // Create ~8000 characters of content (two paragraphs separated by blank line)
      const para1 = 'A'.repeat(3500)
      const para2 = 'B'.repeat(3500)
      const content = `${para1}\n\n${para2}`

      const result = fmt.splitForTelegram(content)

      expect(result.length).toBeGreaterThanOrEqual(2)
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(4096)
      }
      // Joined result should contain the full content
      const joined = result.join('')
      expect(joined).toContain('A'.repeat(100))
      expect(joined).toContain('B'.repeat(100))
    })

    it('empty content returns a single empty string chunk', () => {
      const result = fmt.splitForTelegram('')
      // splitHtmlAtSemanticBoundary treats '' as ≤ maxLen → returns ['']
      expect(result).toHaveLength(1)
      expect(result[0]).toBe('')
    })
  })

  // ── formatEvoseSummary — safe length limit ──────────────────────────────────

  describe('formatEvoseSummary — safe length', () => {
    it('long text result includes total character count', () => {
      const result = fmt.formatEvoseSummary({
        type: 'tool_use',
        id: 'tu-long',
        name: 'mcp__opencow-capabilities__evose_run_agent',
        input: { app_id: 'agent-writer' },
        progressBlocks: [
          { type: 'tool_call', toolCallId: 'tc-1', toolName: 'research', title: 'Research', status: 'completed' as const },
          { type: 'text', text: 'C'.repeat(1200) },
        ],
      })

      expect(result).not.toBeNull()
      expect(result!).toContain('1200 chars total')
    })

    it('total output does not exceed 4000 characters', () => {
      const result = fmt.formatEvoseSummary({
        type: 'tool_use',
        id: 'tu-max',
        name: 'mcp__opencow-capabilities__evose_run_agent',
        input: { app_id: 'agent-writer' },
        progressBlocks: [
          ...Array.from({ length: 10 }, (_, i) => ({
            type: 'tool_call' as const,
            toolCallId: `tc-${i}`,
            toolName: 'tool',
            title: 'A'.repeat(50),
            status: 'completed' as const,
          })),
          { type: 'text' as const, text: 'D'.repeat(5000) },
        ],
      })

      expect(result).not.toBeNull()
      expect(result!.length).toBeLessThanOrEqual(4000)
    })
  })
})
