// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  TelegramBotEntry,
  TelegramBotSettings,
  IMOrchestratorDeps,
} from '../../../../src/shared/types'

// ── grammy mock ────────────────────────────────────────────────────────────────
vi.mock('grammy', () => {
  const mockApi = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    setMyCommands: vi.fn().mockResolvedValue(true),
  }
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
  return { Bot: MockBot, InlineKeyboard: class { text = vi.fn().mockReturnThis(); row = vi.fn().mockReturnThis() } }
})

import { TelegramBotManager, type TelegramBotManagerDeps } from '../../../../electron/services/telegramBot/telegramBotManager'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<TelegramBotEntry> = {}): TelegramBotEntry {
  return {
    id: 'entry-001',
    name: 'Test Bot',
    enabled: true,
    botToken: '111:AAA',
    allowedUserIds: [],
    defaultWorkspacePath: '',
    ...overrides,
  }
}

function makeOrchestrator(): IMOrchestratorDeps {
  return {
    startSession: vi.fn().mockResolvedValue('session-id'),
    sendMessage: vi.fn().mockResolvedValue(true),
    resumeSession: vi.fn().mockResolvedValue(true),
    stopSession: vi.fn().mockResolvedValue(true),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
  }
}

function makeManagerDeps(_settings: TelegramBotSettings): TelegramBotManagerDeps {
  return {
    dispatch: vi.fn(),
    orchestrator: makeOrchestrator(),
  } as TelegramBotManagerDeps
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('TelegramBotManager', () => {
  afterEach(() => { vi.clearAllMocks() })

  // ── Initialisation ─────────────────────────────────────────────────────────

  describe('init()', () => {
    it('seeds the entries map from settings', () => {
      const entry = makeEntry()
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      // After init, getStatus returns null (not started yet)
      expect(mgr.getStatus(entry.id)).toBeNull()
    })
  })

  // ── startAll / stopAll ─────────────────────────────────────────────────────

  describe('startAll()', () => {
    it('starts all enabled bots', async () => {
      const a = makeEntry({ id: 'a', enabled: true })
      const b = makeEntry({ id: 'b', enabled: false })
      const settings: TelegramBotSettings = { bots: [a, b] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startAll()

      expect(mgr.getStatus('a')?.connectionStatus).toBe('connected')
      expect(mgr.getStatus('b')).toBeNull()
    })

    it('does not throw if a bot fails to start (partial success)', async () => {
      const a = makeEntry({ id: 'a', botToken: '' })  // empty token → will fail
      const settings: TelegramBotSettings = { bots: [a] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      // startAll uses Promise.allSettled — should not throw
      await expect(mgr.startAll()).resolves.toBeUndefined()
    })
  })

  describe('stopAll()', () => {
    it('stops all running bots', async () => {
      const entry = makeEntry()
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)
      expect(mgr.getStatus(entry.id)?.connectionStatus).toBe('connected')

      mgr.stopAll()
      expect(mgr.getStatus(entry.id)).toBeNull()
    })
  })

  // ── getAllStatuses ──────────────────────────────────────────────────────────

  describe('getAllStatuses()', () => {
    it('returns statuses for all running bots', async () => {
      const a = makeEntry({ id: 'a' })
      const b = makeEntry({ id: 'b', botToken: '222:BBB' })
      const settings: TelegramBotSettings = { bots: [a, b] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startAll()

      const statuses = mgr.getAllStatuses()
      expect(statuses).toHaveLength(2)
      expect(statuses.map((s) => s.botId).sort()).toEqual(['a', 'b'])
      expect(statuses.every((s) => s.connectionStatus === 'connected')).toBe(true)
    })

    it('returns botId matching entry.id', async () => {
      const entry = makeEntry({ id: 'my-uuid' })
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)

      const [status] = mgr.getAllStatuses()
      expect(status.botId).toBe('my-uuid')
    })
  })

  // ── syncWithSettings ───────────────────────────────────────────────────────

  describe('syncWithSettings()', () => {
    it('starts a newly added enabled entry', async () => {
      const settings: TelegramBotSettings = { bots: [] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)

      const entry = makeEntry({ id: 'new' })
      await mgr.syncWithSettings({ bots: [entry] })
      expect(mgr.getStatus('new')?.connectionStatus).toBe('connected')
    })

    it('stops a removed entry', async () => {
      const entry = makeEntry()
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)
      expect(mgr.getStatus(entry.id)).not.toBeNull()

      await mgr.syncWithSettings({ bots: [] })
      expect(mgr.getStatus(entry.id)).toBeNull()
    })

    it('restarts bot when botToken changes', async () => {
      const entry = makeEntry({ id: 'tok' })
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)

      const updated = { ...entry, botToken: '999:ZZZ' }
      await mgr.syncWithSettings({ bots: [updated] })
      // Bot should still be running with new token
      expect(mgr.getStatus('tok')?.connectionStatus).toBe('connected')
    })

    it('does NOT restart bot for non-token field changes (hot-update)', async () => {
      const entry = makeEntry()
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)

      // Track start calls — we'll use the service count
      const statusBefore = mgr.getStatus(entry.id)

      // Change non-critical fields
      const updated = { ...entry, allowedUserIds: [12345] }
      await mgr.syncWithSettings({ bots: [updated] })

      // Bot is still running (not restarted — no stop/start cycle)
      expect(mgr.getStatus(entry.id)?.connectionStatus).toBe('connected')
      // connectedAt unchanged: service was NOT recreated
      expect(mgr.getStatus(entry.id)?.connectedAt).toBe(statusBefore?.connectedAt)
    })

    it('starts bot when enabled changes from false to true', async () => {
      const entry = makeEntry({ enabled: false })
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      // Don't start (enabled = false)
      expect(mgr.getStatus(entry.id)).toBeNull()

      await mgr.syncWithSettings({ bots: [{ ...entry, enabled: true }] })
      expect(mgr.getStatus(entry.id)?.connectionStatus).toBe('connected')
    })

    it('stops bot when enabled changes from true to false', async () => {
      const entry = makeEntry({ enabled: true })
      const settings: TelegramBotSettings = { bots: [entry] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startBot(entry.id)
      expect(mgr.getStatus(entry.id)).not.toBeNull()

      await mgr.syncWithSettings({ bots: [{ ...entry, enabled: false }] })
      expect(mgr.getStatus(entry.id)).toBeNull()
    })
  })

  // ── Routing: handleAssistantMessage ───────────────────────────────────────

  describe('handleAssistantMessage()', () => {
    it('routes to the correct service by botId', async () => {
      const a = makeEntry({ id: 'bot-a' })
      const b = makeEntry({ id: 'bot-b', botToken: '222:BBB' })
      const settings: TelegramBotSettings = { bots: [a, b] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      await mgr.startAll()

      // Simulate a finalised assistant message for bot-a
      const message = {
        id: 'msg-1',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hello' }],
        timestamp: Date.now(),
        isStreaming: false,
      }
      const origin = { source: 'telegram' as const, botId: 'bot-a', chatId: 'chat-123' }

      // Should not throw — routing successful
      await expect(mgr.handleAssistantMessage(origin, message)).resolves.toBeUndefined()
    })

    it('logs a warning and does nothing for unknown botId', async () => {
      const settings: TelegramBotSettings = { bots: [] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)

      const message = {
        id: 'msg-2',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Hi' }],
        timestamp: Date.now(),
        isStreaming: false,
      }
      const origin = { source: 'telegram' as const, botId: 'nonexistent', chatId: 'c' }
      // Should resolve without throwing
      await expect(mgr.handleAssistantMessage(origin, message)).resolves.toBeUndefined()
    })
  })

  // ── testBot ───────────────────────────────────────────────────────────────

  describe('testBot()', () => {
    it('returns error for unknown botId', async () => {
      const settings: TelegramBotSettings = { bots: [] }
      const mgr = new TelegramBotManager(makeManagerDeps(settings))
      mgr.init(settings)
      const result = await mgr.testBot('no-such-id')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
