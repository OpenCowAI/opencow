// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditStreamingStrategy } from '../../../../../electron/services/telegramBot/streaming/editStrategy'

/**
 * EditStreamingStrategy unit tests.
 *
 * Directly constructs a mock Api object (duck typing), no need for vi.mock('grammy').
 * The strategy only depends on Api's sendMessage / editMessageText / sendChatAction methods.
 */

function createMockApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue({}),
    sendChatAction: vi.fn().mockResolvedValue(true),
  }
}

describe('EditStreamingStrategy', () => {
  let api: ReturnType<typeof createMockApi>
  let onMessageSent: ReturnType<typeof vi.fn>
  let strategy: EditStreamingStrategy

  beforeEach(() => {
    api = createMockApi()
    onMessageSent = vi.fn()
    strategy = new EditStreamingStrategy(api as any, onMessageSent)
  })

  // ── sendUpdate ──────────────────────────────────────────────────────────

  describe('sendUpdate', () => {
    it('first call uses sendMessage to create placeholder bubble with stop button', async () => {
      const ok = await strategy.sendUpdate({
        chatId: '42',
        content: 'Working...',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(true)
      expect(api.sendMessage).toHaveBeenCalledWith(
        '42',
        'Working...',
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⏹️ Stop', callback_data: 'stop:sess-1' }]],
          },
        }),
      )
      expect(onMessageSent).toHaveBeenCalledOnce()
    })

    it('returns false when first sendMessage fails', async () => {
      api.sendMessage.mockRejectedValueOnce(new Error('network error'))

      const ok = await strategy.sendUpdate({
        chatId: '42',
        content: 'Working...',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(false)
      expect(onMessageSent).not.toHaveBeenCalled()
    })

    it('subsequent calls use editMessageText to update content', async () => {
      // First call
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })

      // Advance time past the throttle window
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)

      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.editMessageText).toHaveBeenCalledWith(
        '42',
        100, // message_id from sendMessage mock
        'Step 2',
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⏹️ Stop', callback_data: 'stop:sess-1' }]],
          },
        }),
      )

      vi.restoreAllMocks()
    })

    it('updates within the throttle window are skipped', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      api.editMessageText.mockClear()

      // Do not advance time, call again immediately
      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.editMessageText).not.toHaveBeenCalled()
    })

    it('skips edit when content is unchanged', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Same', sessionId: 'sess-1' })
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
      api.editMessageText.mockClear()

      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Same', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.editMessageText).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('auto-cleans state when message is deleted (400 + "not found")', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      expect(strategy.hasActive('42')).toBe(true)

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
      api.editMessageText.mockRejectedValueOnce({
        error_code: 400,
        description: 'Bad Request: message to edit not found',
      })

      await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      // State is cleaned up — next call will create a new bubble
      expect(strategy.hasActive('42')).toBe(false)
      vi.restoreAllMocks()
    })

    it('refreshes typing indicator after successful editMessageText', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      api.sendChatAction.mockClear()

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(api.sendChatAction).toHaveBeenCalledWith('42', 'typing')
      vi.restoreAllMocks()
    })

    it('manages state independently for different chatIds', async () => {
      await strategy.sendUpdate({ chatId: '100', content: 'Chat A', sessionId: 's1' })
      await strategy.sendUpdate({ chatId: '200', content: 'Chat B', sessionId: 's2' })

      expect(strategy.hasActive('100')).toBe(true)
      expect(strategy.hasActive('200')).toBe(true)
      expect(api.sendMessage).toHaveBeenCalledTimes(2)
    })
  })

  // ── sendUpdate — concurrency guard ──────────────────────────────────────

  describe('sendUpdate — concurrency guard', () => {
    it('updates during inflight are buffered rather than sent concurrently', async () => {
      // First update creates the bubble
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })

      // Advance past throttle window
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)

      // Make editMessageText slow — simulate proxy latency
      let resolveEdit!: () => void
      api.editMessageText.mockImplementationOnce(() =>
        new Promise<void>((resolve) => { resolveEdit = resolve })
      )

      // Start an inflight edit (don't await yet)
      const editPromise = strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })
      expect(api.editMessageText).toHaveBeenCalledTimes(1)

      // Another update while inflight — should NOT start a second API call
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 3', sessionId: 'sess-1' })
      expect(api.editMessageText).toHaveBeenCalledTimes(1) // still only 1

      // Complete the inflight call — pending content should be flushed
      resolveEdit()
      await editPromise

      // Pending content (Step 3) should now be sent
      expect(api.editMessageText).toHaveBeenCalledTimes(2)
      expect(api.editMessageText).toHaveBeenLastCalledWith(
        '42',
        100,
        'Step 3',
        expect.any(Object),
      )

      vi.restoreAllMocks()
    })

    it('out-of-order completion is prevented — latest content always wins', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)

      // Slow edit for Step 2
      let resolveStep2!: () => void
      api.editMessageText.mockImplementationOnce(() =>
        new Promise<void>((resolve) => { resolveStep2 = resolve })
      )

      const p2 = strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      // Step 3 arrives while Step 2 is inflight
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 3', sessionId: 'sess-1' })

      // Step 4 arrives — only latest pending is kept
      await strategy.sendUpdate({ chatId: '42', content: 'Step 4', sessionId: 'sess-1' })

      // Complete Step 2's API call
      resolveStep2()
      await p2

      // Should have flushed only Step 4 (latest), not Step 3
      expect(api.editMessageText).toHaveBeenCalledTimes(2) // Step 2 + Step 4
      expect(api.editMessageText).toHaveBeenLastCalledWith(
        '42',
        100,
        'Step 4',
        expect.any(Object),
      )

      vi.restoreAllMocks()
    })
  })

  // ── finalize ────────────────────────────────────────────────────────────

  describe('finalize', () => {
    it('replaces placeholder message and removes stop button, returns true', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })

      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: ['<b>Final answer</b>', 'chunk 2'],
      })

      expect(result).toBe(true)
      expect(api.editMessageText).toHaveBeenCalledWith(
        '42',
        100,
        '<b>Final answer</b>',
        expect.objectContaining({
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: [] },
        }),
      )
      // State is cleaned up
      expect(strategy.hasActive('42')).toBe(false)
    })

    it('returns false when there is no active bubble', async () => {
      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: ['<b>Final</b>'],
      })

      expect(result).toBe(false)
      expect(api.editMessageText).not.toHaveBeenCalled()
    })

    it('returns true when htmlChunks is empty (no-op)', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })

      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: [],
      })

      expect(result).toBe(true)
    })

    it('returns false when editMessageText replacement fails', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })
      api.editMessageText.mockRejectedValueOnce(new Error('network error'))

      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: ['<b>Final</b>'],
      })

      expect(result).toBe(false)
      // State is cleaned up (clean up even on failure to avoid stale state)
      expect(strategy.hasActive('42')).toBe(false)
    })
  })

  // ── release / releaseAll / hasActive ──────────────────────────────────

  describe('lifecycle management', () => {
    it('release cleans up state for the specified chatId', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'test', sessionId: 's1' })
      expect(strategy.hasActive('42')).toBe(true)

      strategy.release('42')
      expect(strategy.hasActive('42')).toBe(false)
    })

    it('releasing a non-existent chatId does not throw', () => {
      expect(() => strategy.release('nonexistent')).not.toThrow()
    })

    it('releaseAll cleans up state for all chatIds', async () => {
      await strategy.sendUpdate({ chatId: '100', content: 'A', sessionId: 's1' })
      await strategy.sendUpdate({ chatId: '200', content: 'B', sessionId: 's2' })

      strategy.releaseAll()

      expect(strategy.hasActive('100')).toBe(false)
      expect(strategy.hasActive('200')).toBe(false)
    })
  })
})
