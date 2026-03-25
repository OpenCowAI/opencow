// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type {
  TelegramBotEntry,
  ManagedSessionInfo,
  ManagedSessionMessage,
  SessionOrigin,
} from '../../../../src/shared/types'

// ── vi.hoisted — ensure mockApi reference is ready before vi.mock hoisting ───
// vi.hoisted runs before the vi.mock factory, allowing us to reference the same
// object inside vi.mock while also accessing mockApi directly in tests to verify
// call arguments.
const mockApi = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
  editMessageText: vi.fn().mockResolvedValue({}),
  sendChatAction: vi.fn().mockResolvedValue(true),
  setMyCommands: vi.fn().mockResolvedValue(true),
  getFile: vi.fn().mockResolvedValue({ file_path: 'photos/file_1.jpg' }),
  sendMessageDraft: vi.fn().mockResolvedValue(true),
}))

// mock grammy — avoid real network calls
vi.mock('grammy', () => {
  class MockBot {
    api = mockApi
    botInfo = { username: 'test_bot' }
    command = vi.fn()
    on = vi.fn()
    callbackQuery = vi.fn()
    start = vi.fn().mockImplementation((opts?: { onStart?: () => void }) => {
      opts?.onStart?.()
      return Promise.resolve()
    })
    stop = vi.fn()
    init = vi.fn().mockResolvedValue(undefined)
  }
  class MockInlineKeyboard {
    text = vi.fn().mockReturnThis()
    row = vi.fn().mockReturnThis()
  }
  return {
    Bot: MockBot,
    InlineKeyboard: MockInlineKeyboard,
  }
})

import { TelegramBotService, type TelegramBotServiceDeps } from '../../../../electron/services/telegramBot/telegramBotService'

const TEST_BOT_ENTRY: TelegramBotEntry = {
  id: 'test-entry-uuid-001',
  name: 'Test Bot',
  enabled: true,
  botToken: '123:ABC',
  allowedUserIds: [],
  defaultWorkspacePath: '',
}

function makeDeps(overrides: Partial<TelegramBotServiceDeps> = {}): TelegramBotServiceDeps {
  return {
    dispatch: vi.fn(),
    getConfig: () => ({ ...TEST_BOT_ENTRY }),
    orchestrator: {
      startSession: vi.fn().mockResolvedValue('sess-new'),
      sendMessage: vi.fn().mockResolvedValue(true),
      resumeSession: vi.fn().mockResolvedValue(true),
      stopSession: vi.fn().mockResolvedValue(true),
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn().mockResolvedValue(null),
    } as any,
    ...overrides,
  }
}

describe('TelegramBotService', () => {
  let service: TelegramBotService

  afterEach(() => { service?.stop() })

  it('is in disconnected state on initialization', () => {
    service = new TelegramBotService(makeDeps())
    expect(service.getStatus().connectionStatus).toBe('disconnected')
    expect(service.getStatus().messagesReceived).toBe(0)
  })

  it('start() transitions to connected', async () => {
    service = new TelegramBotService(makeDeps())
    await service.start()
    expect(service.getStatus().connectionStatus).toBe('connected')
    expect(service.getStatus().connectedAt).toBeGreaterThan(0)
  })

  it('stop() transitions to disconnected', async () => {
    service = new TelegramBotService(makeDeps())
    await service.start()
    service.stop()
    expect(service.getStatus().connectionStatus).toBe('disconnected')
  })

  it('dispatches messaging:status event on start', async () => {
    const deps = makeDeps()
    service = new TelegramBotService(deps)
    await service.start()
    expect(deps.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messaging:status' })
    )
  })

  it('handleCommand routes /status to orchestrator.listSessions', async () => {
    const deps = makeDeps()
    ;(deps.orchestrator.listSessions as any).mockResolvedValue([
      { id: 's1', state: 'streaming', activity: 'Editing', messages: [], origin: { source: 'telegram', botId: 'test-entry-uuid-001', chatId: '100' } } as Partial<ManagedSessionInfo>,
    ])
    service = new TelegramBotService(deps)
    const result = await service.handleCommand('/status', 100, '100')
    expect(deps.orchestrator.listSessions).toHaveBeenCalled()
    expect(result).toBeDefined()
    expect(result!.text).toContain('s1')
  })

  it('handleCommand routes /ask to orchestrator.startSession', async () => {
    const deps = makeDeps()
    service = new TelegramBotService(deps)
    const result = await service.handleCommand('/ask Fix the bug', 100, '100')
    expect(deps.orchestrator.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: [{ type: 'text', text: 'Fix the bug' }] })
    )
    // /ask with prompt → noop (streaming response is the feedback)
    expect(result).toBeNull()
  })

  it('rejects unauthorized users when allowedUserIds is set', async () => {
    const deps = makeDeps({
      getConfig: () => ({
        ...TEST_BOT_ENTRY,
        allowedUserIds: [100],
      }),
    })
    service = new TelegramBotService(deps)
    const result = await service.handleCommand('/status', 999, '999')
    expect(result!.text).toContain('Permission Denied')
  })

  it('handleCommand /new without prompt returns ForceReply (selective: true)', async () => {
    service = new TelegramBotService(makeDeps())
    const result = await service.handleCommand('/new', 100, '100')
    expect(result).not.toBeNull()
    const markup = result!.reply_markup as any
    expect(markup?.force_reply).toBe(true)
    // selective:true ensures ForceReply only targets the replied-to user (Bot API best practice)
    expect(markup?.selective).toBe(true)
  })

  it('handleCommand /clear returns friendly message when no active sessions', async () => {
    const deps = makeDeps()
    ;(deps.orchestrator.listSessions as any).mockResolvedValue([])
    service = new TelegramBotService(deps)
    const result = await service.handleCommand('/clear', 100, '100')
    expect(result).not.toBeNull()
    expect(result!.text).toContain('No active session')
  })

  // ── handleAssistantMessage — streaming bubble lifecycle ─────────────────────
  describe('handleAssistantMessage — streaming bubble lifecycle', () => {
    // Clear mockApi call records before each sub-test to prevent cross-test pollution.
    // mockResolvedValue default return values are preserved after mockClear.
    beforeEach(() => {
      mockApi.sendMessage.mockClear()
      mockApi.editMessageText.mockClear()
      mockApi.sendChatAction.mockClear()
      mockApi.sendMessageDraft.mockClear()
    })

    const makeOrigin = (chatId: string): SessionOrigin => ({
      source: 'telegram',
      botId: 'test-entry-uuid-001',
      chatId,
    })

    // ── Edit strategy path (group chatId — negative) ──────────────────────────

    it('group chatId uses Edit strategy: sends bubble with stop button', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Negative chatId -> group -> Edit strategy (Draft does not support groups)
      const origin = makeOrigin('-100501')
      const msg: ManagedSessionMessage = {
        id: 'm1',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Hello Claude' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, msg, 'full-uuid-stop-test')

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        '-100501',
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: [[
              expect.objectContaining({ callback_data: 'stop:full-uuid-stop-test' }),
            ]],
          }),
        }),
      )
      expect(mockApi.sendMessageDraft).not.toHaveBeenCalled()
    })

    it('group chatId finalization: editMessageText replaces bubble and removes stop button', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const origin = makeOrigin('-100502')
      const streamMsg: ManagedSessionMessage = {
        id: 'm2',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Working on it...' }],
        timestamp: Date.now(),
      }
      const finalMsg: ManagedSessionMessage = {
        id: 'm3',
        role: 'assistant',
        isStreaming: false,
        content: [{ type: 'text', text: 'Done!' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, streamMsg, 'sess-finalize-test')
      await service.handleAssistantMessage(origin, finalMsg, 'sess-finalize-test')

      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        '-100502',
        42,                    // tgMessageId from sendMessage return value
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: [] }, // stop button removed
        }),
      )
    })

    // ── Draft strategy path (private chat chatId — positive integer) ───────────

    it('private chat chatId uses Draft strategy: calls sendMessageDraft', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Positive integer chatId -> private chat -> Draft strategy
      const origin = makeOrigin('601')
      const msg: ManagedSessionMessage = {
        id: 'm6',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Hello from draft' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, msg, 'sess-draft-test')

      expect(mockApi.sendMessageDraft).toHaveBeenCalledWith(
        601,                    // numeric chatId
        expect.any(Number),     // draftId
        expect.any(String),     // content
      )
      // Draft strategy does not call sendMessage
      expect(mockApi.sendMessage).not.toHaveBeenCalled()
    })

    it('private chat Draft finalization returns false: all chunks sent via sendMessage', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const origin = makeOrigin('602')
      const streamMsg: ManagedSessionMessage = {
        id: 'm7',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Drafting...' }],
        timestamp: Date.now(),
      }
      const finalMsg: ManagedSessionMessage = {
        id: 'm8',
        role: 'assistant',
        isStreaming: false,
        content: [{ type: 'text', text: 'Final answer' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, streamMsg, 'sess-draft-fin')
      await service.handleAssistantMessage(origin, finalMsg, 'sess-draft-fin')

      // Draft finalize returns false -> first chunk sent via new sendMessage
      expect(mockApi.sendMessage).toHaveBeenCalled()
      // Draft does not support editMessageText replacement
      expect(mockApi.editMessageText).not.toHaveBeenCalled()
    })

    it('Draft auto-degrades to Edit strategy on first failure', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // sendMessageDraft fails on first attempt
      mockApi.sendMessageDraft.mockRejectedValueOnce(new Error('API not available'))

      const origin = makeOrigin('603')
      const msg: ManagedSessionMessage = {
        id: 'm9',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Draft failed, using edit' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, msg, 'sess-degradation')

      // After Draft failure, degrades to sendMessage (Edit strategy)
      expect(mockApi.sendMessageDraft).toHaveBeenCalled()
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        '603',
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: expect.objectContaining({
            inline_keyboard: [[
              expect.objectContaining({ callback_data: 'stop:sess-degradation' }),
            ]],
          }),
        }),
      )
    })

    // ── Evose progress retention (commit mechanism) ────────────────────────

    it('Evose progress is committed as permanent message before new Claude streaming round (Edit strategy)', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Group chatId -> Edit strategy
      const origin = makeOrigin('-100700')

      // Step 1: Evose progress updates placeholder message
      const evoseMsg: ManagedSessionMessage = {
        id: 'm-evose',
        role: 'assistant',
        isStreaming: false,
        content: [{
          type: 'tool_use',
          id: 'tu-1',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-x-analyst' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-1', toolName: 'web_search', title: 'Web Search', status: 'completed' as const },
            { type: 'text', text: 'Analysis complete.' },
          ],
        }],
        timestamp: Date.now(),
      }
      await service.handleEvoseProgress(origin, evoseMsg, 'sess-evose-commit')

      // Verify placeholder message was created
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1)
      mockApi.sendMessage.mockClear()
      mockApi.editMessageText.mockClear()

      // Step 2: Claude starts new streaming round -> should commit Evose before overwriting
      const claudeStreamMsg: ManagedSessionMessage = {
        id: 'm-claude-stream',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Based on the analysis...' }],
        timestamp: Date.now(),
      }
      await service.handleAssistantMessage(origin, claudeStreamMsg, 'sess-evose-commit')

      // Evose content is persisted as a permanent message via editMessageText
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        '-100700',
        42, // message_id from sendMessage mock
        expect.stringContaining('Evose Agent (agent-x-analyst)'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }, // no stop button
        }),
      )

      // Then a new message is created for Claude streaming output
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('finalize branch also commits Evose progress (prevents overwriting)', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const origin = makeOrigin('-100702')

      // Step 1: Evose progress -> creates placeholder message
      const evoseMsg: ManagedSessionMessage = {
        id: 'm-evose-finalize',
        role: 'assistant',
        isStreaming: false,
        content: [{
          type: 'tool_use',
          id: 'tu-fin',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-researcher' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-f1', toolName: 'web_search', title: 'Web Search', status: 'completed' as const },
          ],
        }],
        timestamp: Date.now(),
      }
      await service.handleEvoseProgress(origin, evoseMsg, 'sess-finalize')
      expect(mockApi.sendMessage).toHaveBeenCalled()
      mockApi.sendMessage.mockClear()
      mockApi.editMessageText.mockClear()

      // Step 2: SDK turn finalized (isStreaming=false) -> should commit Evose first
      const finalizedMsg: ManagedSessionMessage = {
        id: 'm-finalized',
        role: 'assistant',
        isStreaming: false,
        content: [{ type: 'text', text: 'Here are the results.' }],
        timestamp: Date.now(),
      }
      await service.handleAssistantMessage(origin, finalizedMsg, 'sess-finalize')

      // Evose content is persisted as a permanent message via editMessageText
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        '-100702',
        42,
        expect.stringContaining('Evose Agent (agent-researcher)'),
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        }),
      )
    })

    it('Draft strategy Evose progress commit: sends permanent message then releases draft (no gap)', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Positive integer chatId -> private chat -> Draft strategy
      const origin = makeOrigin('800')

      // Step 1: Evose progress displayed via draft
      const evoseMsg: ManagedSessionMessage = {
        id: 'm-evose-draft',
        role: 'assistant',
        isStreaming: false,
        content: [{
          type: 'tool_use',
          id: 'tu-draft',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-analyst' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-d1', toolName: 'search', title: 'Search', status: 'completed' as const },
            { type: 'text', text: 'Draft analysis result.' },
          ],
        }],
        timestamp: Date.now(),
      }
      await service.handleEvoseProgress(origin, evoseMsg, 'sess-draft-evose')

      // Draft strategy: should use sendMessageDraft, not sendMessage
      expect(mockApi.sendMessageDraft).toHaveBeenCalled()
      mockApi.sendMessage.mockClear()
      mockApi.sendMessageDraft.mockClear()

      // Step 2: Claude starts new streaming round -> commit Evose progress
      const claudeMsg: ManagedSessionMessage = {
        id: 'm-claude-draft',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Here is the analysis...' }],
        timestamp: Date.now(),
      }
      await service.handleAssistantMessage(origin, claudeMsg, 'sess-draft-evose')

      // Draft commit flow: first sendMessage (permanent message), then release (draft disappears)
      // First sendMessage commits Evose content, second is the new draft streaming
      const sendMessageCalls = mockApi.sendMessage.mock.calls
      expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1)

      // Verify committed Evose content contains Agent name
      const commitCall = sendMessageCalls[0]
      expect(commitCall[0]).toBe('800')
      expect(commitCall[1]).toContain('Evose Agent (agent-analyst)')

      // Subsequent Claude text is sent via a new draft
      expect(mockApi.sendMessageDraft).toHaveBeenCalled()
    })

    it('long Evose content is auto-split into multiple permanent messages (Edit strategy)', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Group chatId -> Edit strategy
      const origin = makeOrigin('-100800')

      // Step 1: Evose progress with very long text (> 4096 chars)
      const longText = 'X'.repeat(6000)
      const evoseMsg: ManagedSessionMessage = {
        id: 'm-evose-long',
        role: 'assistant',
        isStreaming: false,
        content: [{
          type: 'tool_use',
          id: 'tu-long',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-writer' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-l1', toolName: 'research', title: 'Deep Research', status: 'completed' as const },
            { type: 'text', text: longText },
          ],
        }],
        timestamp: Date.now(),
      }
      await service.handleEvoseProgress(origin, evoseMsg, 'sess-long-evose')

      // Verify placeholder message was created
      expect(mockApi.sendMessage).toHaveBeenCalledTimes(1)
      mockApi.sendMessage.mockClear()
      mockApi.editMessageText.mockClear()

      // Step 2: Claude starts new streaming round -> commit long Evose content
      const claudeMsg: ManagedSessionMessage = {
        id: 'm-claude-long',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Summary of findings...' }],
        timestamp: Date.now(),
      }
      await service.handleAssistantMessage(origin, claudeMsg, 'sess-long-evose')

      // First chunk replaces the placeholder via editMessageText
      expect(mockApi.editMessageText).toHaveBeenCalledTimes(1)
      expect(mockApi.editMessageText).toHaveBeenCalledWith(
        '-100800',
        42,
        expect.any(String),
        expect.objectContaining({ parse_mode: 'HTML' }),
      )

      // Remaining chunks are sent via sendMessage (at least 1 extra message + 1 new Claude streaming)
      // sendMessage call count >= 2 (at least 1 extra Evose chunk + 1 new Claude placeholder)
      expect(mockApi.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('long Evose content Draft strategy: sends all chunks then releases', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      // Positive integer chatId -> private chat -> Draft strategy
      const origin = makeOrigin('900')

      // Step 1: Evose progress with long text
      const longText = 'Y'.repeat(6000)
      const evoseMsg: ManagedSessionMessage = {
        id: 'm-evose-draft-long',
        role: 'assistant',
        isStreaming: false,
        content: [{
          type: 'tool_use',
          id: 'tu-draft-long',
          name: 'mcp__opencow-capabilities__evose_run_agent',
          input: { app_id: 'agent-analyst' },
          progressBlocks: [
            { type: 'tool_call', toolCallId: 'tc-dl1', toolName: 'search', title: 'Search', status: 'completed' as const },
            { type: 'text', text: longText },
          ],
        }],
        timestamp: Date.now(),
      }
      await service.handleEvoseProgress(origin, evoseMsg, 'sess-draft-long')

      expect(mockApi.sendMessageDraft).toHaveBeenCalled()
      mockApi.sendMessage.mockClear()
      mockApi.sendMessageDraft.mockClear()

      // Step 2: Claude streaming -> commit long Evose content
      const claudeMsg: ManagedSessionMessage = {
        id: 'm-claude-draft-long',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Here are the results...' }],
        timestamp: Date.now(),
      }
      await service.handleAssistantMessage(origin, claudeMsg, 'sess-draft-long')

      // Draft commit: all Evose chunks sent via sendMessage (>= 2 chunk messages)
      // plus Claude new streaming via sendMessageDraft
      const sendMessageCalls = mockApi.sendMessage.mock.calls
      expect(sendMessageCalls.length).toBeGreaterThanOrEqual(2)

      // First sendMessage should contain Agent name
      expect(sendMessageCalls[0][1]).toContain('Evose Agent (agent-analyst)')

      // Subsequent Claude text uses a new draft
      expect(mockApi.sendMessageDraft).toHaveBeenCalled()
    })

    it('Claude streaming does not trigger extra operations when there is no Evose progress', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const origin = makeOrigin('-100701')
      const msg: ManagedSessionMessage = {
        id: 'm-no-evose',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'Hello' }],
        timestamp: Date.now(),
      }

      mockApi.editMessageText.mockClear()
      await service.handleAssistantMessage(origin, msg, 'sess-no-evose')

      // No Evose commit -> should not call editMessageText
      expect(mockApi.editMessageText).not.toHaveBeenCalled()
      // Only creates a single streaming placeholder message
      expect(mockApi.sendMessage).toHaveBeenCalled()
    })

    // ── General scenarios ──────────────────────────────────────────────────

    it('does not send any messages when content is empty', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const origin = makeOrigin('503')
      const emptyMsg: ManagedSessionMessage = {
        id: 'm4',
        role: 'assistant',
        isStreaming: true,
        content: [],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(origin, emptyMsg, 'sess-empty')

      expect(mockApi.sendMessage).not.toHaveBeenCalled()
      expect(mockApi.sendMessageDraft).not.toHaveBeenCalled()
    })

    it('ignores SessionOrigin with non-telegram source', async () => {
      service = new TelegramBotService(makeDeps())
      await service.start()

      const agentOrigin = { source: 'agent' } as unknown as SessionOrigin
      const msg: ManagedSessionMessage = {
        id: 'm5',
        role: 'assistant',
        isStreaming: true,
        content: [{ type: 'text', text: 'hi' }],
        timestamp: Date.now(),
      }

      await service.handleAssistantMessage(agentOrigin, msg, 'sess-agent')

      expect(mockApi.sendMessage).not.toHaveBeenCalled()
      expect(mockApi.sendMessageDraft).not.toHaveBeenCalled()
    })
  })

  // ── notifySessionDone — turn completion notification ────────────────────────
  describe('notifySessionDone', () => {
    const origin = { source: 'telegram' as const, botId: 'bot-1', chatId: '300' }

    beforeEach(() => {
      mockApi.sendMessage.mockClear()
    })

    it('normal completion sends HTML message containing checkmark', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      await service.start()

      await service.notifySessionDone(origin, 'end_turn')

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        '300',
        expect.stringContaining('✅'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      )
    })

    it('sends message containing warning emoji with truncation warning on max_tokens', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      await service.start()

      await service.notifySessionDone(origin, 'max_tokens')

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        '300',
        expect.stringContaining('⚠️'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      )
    })

    it('silently ignores when bot is not started (no error thrown)', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      // Do not call start() — bot is null

      await expect(service.notifySessionDone(origin, 'end_turn')).resolves.toBeUndefined()
      expect(mockApi.sendMessage).not.toHaveBeenCalled()
    })
  })

  // ── Voice message handling ────────────────────────────────────────────────
  describe('handleVoiceMessage', () => {
    it('returns denied for unauthorized users', async () => {
      const deps = makeDeps({
        getConfig: () => ({ ...TEST_BOT_ENTRY, allowedUserIds: [100] }),
      })
      service = new TelegramBotService(deps)
      const result = await service.handleVoiceMessage(999, '42')
      expect(result).toBe('denied')
    })

    it('returns not_supported for authorized users (empty allowlist)', async () => {
      const deps = makeDeps() // allowedUserIds: [] => no restriction
      service = new TelegramBotService(deps)
      const result = await service.handleVoiceMessage(100, '42')
      expect(result).toBe('not_supported')
    })

    it('returns not_supported for allowlisted users (authorized but feature not yet supported)', async () => {
      const deps = makeDeps({
        getConfig: () => ({ ...TEST_BOT_ENTRY, allowedUserIds: [100, 200] }),
      })
      service = new TelegramBotService(deps)
      const result = await service.handleVoiceMessage(100, '42')
      expect(result).toBe('not_supported')
    })

    it('does not call any orchestrator methods when not_supported', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      await service.handleVoiceMessage(100, '42')
      expect(deps.orchestrator.startSession).not.toHaveBeenCalled()
      expect(deps.orchestrator.sendMessage).not.toHaveBeenCalled()
      expect(deps.orchestrator.resumeSession).not.toHaveBeenCalled()
    })
  })

  // ── Photo message handling ────────────────────────────────────────────────
  describe('handlePhotoMessage', () => {
    /** Minimal valid photo UserMessageContent */
    const makePhotoContent = (caption?: string) => [
      ...(caption ? [{ type: 'text' as const, text: caption }] : []),
      { type: 'image' as const, mediaType: 'image/jpeg', data: 'base64data==', sizeBytes: 1024 },
    ]

    it('returns denied for unauthorized users', async () => {
      const deps = makeDeps({
        getConfig: () => ({ ...TEST_BOT_ENTRY, allowedUserIds: [100] }),
      })
      service = new TelegramBotService(deps)
      const result = await service.handlePhotoMessage(makePhotoContent(), 999, '42')
      expect(result).toBe('denied')
      expect(deps.orchestrator.startSession).not.toHaveBeenCalled()
    })

    it('calls startSession when there is no active session', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      const content = makePhotoContent('Please analyze this screenshot')
      const result = await service.handlePhotoMessage(content, 100, '42')
      expect(result).toBe('ok')
      expect(deps.orchestrator.startSession).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: content }),
      )
    })

    it('routes normally when no active session and caption is empty', async () => {
      const deps = makeDeps()
      service = new TelegramBotService(deps)
      const content = makePhotoContent() // no caption
      const result = await service.handlePhotoMessage(content, 100, '42')
      expect(result).toBe('ok')
      expect(deps.orchestrator.startSession).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: content }),
      )
    })

    it('calls sendMessage when there is an awaiting_input session', async () => {
      const deps = makeDeps({
        orchestrator: {
          startSession: vi.fn().mockResolvedValue('sess-new'),
          sendMessage: vi.fn().mockResolvedValue(true),
          resumeSession: vi.fn().mockResolvedValue(true),
          stopSession: vi.fn().mockResolvedValue(true),
          listSessions: vi.fn().mockResolvedValue([
            {
              id: 'sess-existing',
              state: 'awaiting_input',
              activity: null,
              messages: [],
              origin: { source: 'telegram', botId: TEST_BOT_ENTRY.id, chatId: '42' },
              lastActivity: Date.now(),
            } as Partial<ManagedSessionInfo>,
          ]),
          getSession: vi.fn().mockResolvedValue(null),
        } as any,
      })
      service = new TelegramBotService(deps)
      const content = makePhotoContent('Analyze this image')
      const result = await service.handlePhotoMessage(content, 100, '42')
      expect(result).toBe('ok')
      expect(deps.orchestrator.sendMessage).toHaveBeenCalledWith('sess-existing', content)
      expect(deps.orchestrator.startSession).not.toHaveBeenCalled()
    })

    it('returns busy when session is streaming', async () => {
      const deps = makeDeps({
        orchestrator: {
          startSession: vi.fn().mockResolvedValue('sess-new'),
          sendMessage: vi.fn().mockResolvedValue(false),
          resumeSession: vi.fn().mockResolvedValue(false),
          stopSession: vi.fn().mockResolvedValue(true),
          listSessions: vi.fn().mockResolvedValue([
            {
              id: 'sess-busy',
              state: 'streaming',
              activity: null,
              messages: [],
              origin: { source: 'telegram', botId: TEST_BOT_ENTRY.id, chatId: '42' },
              lastActivity: Date.now(),
            } as Partial<ManagedSessionInfo>,
          ]),
          getSession: vi.fn().mockResolvedValue(null),
        } as any,
      })
      service = new TelegramBotService(deps)
      const result = await service.handlePhotoMessage(makePhotoContent(), 100, '42')
      expect(result).toBe('busy')
      expect(deps.orchestrator.startSession).not.toHaveBeenCalled()
    })
  })
})
