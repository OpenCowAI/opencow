// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DraftStreamingStrategy } from '../../../../../electron/services/telegramBot/streaming/draftStrategy'

/**
 * DraftStreamingStrategy unit tests.
 *
 * Core concerns:
 *   1. chatId positive/negative validation (positive integer -> supported, otherwise -> returns false)
 *   2. Throttling (300ms) and dedup (skip when content is unchanged)
 *   3. Degradation protocol (first failure -> false, subsequent failures -> true)
 *   4. finalize always returns false (draft cannot be edited/replaced)
 */

function createMockApi() {
  return {
    sendMessageDraft: vi.fn().mockResolvedValue(true),
  }
}

describe('DraftStreamingStrategy', () => {
  let api: ReturnType<typeof createMockApi>
  let strategy: DraftStreamingStrategy

  beforeEach(() => {
    api = createMockApi()
    strategy = new DraftStreamingStrategy(api as any)
  })

  // ── sendUpdate — chatId validation ──────────────────────────────────────────

  describe('sendUpdate — chatId validation', () => {
    it('positive integer chatId calls sendMessageDraft', async () => {
      const ok = await strategy.sendUpdate({
        chatId: '12345',
        content: 'Hello',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(true)
      expect(api.sendMessageDraft).toHaveBeenCalledWith(
        12345,
        expect.any(Number),
        'Hello',
      )
    })

    it('negative chatId (group) returns false, does not call API', async () => {
      const ok = await strategy.sendUpdate({
        chatId: '-1001234567890',
        content: 'Hello',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(false)
      expect(api.sendMessageDraft).not.toHaveBeenCalled()
    })

    it('zero chatId returns false', async () => {
      const ok = await strategy.sendUpdate({
        chatId: '0',
        content: 'Hello',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(false)
    })

    it('non-numeric chatId returns false', async () => {
      const ok = await strategy.sendUpdate({
        chatId: 'invalid',
        content: 'Hello',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(false)
    })
  })

  // ── sendUpdate — throttling and dedup ────────────────────────────────────

  describe('sendUpdate — throttling and dedup', () => {
    it('subsequent updates within 300ms are throttled and skipped', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      api.sendMessageDraft.mockClear()

      // Do not advance time, call again immediately
      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.sendMessageDraft).not.toHaveBeenCalled()
    })

    it('updates normally after exceeding 300ms', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      api.sendMessageDraft.mockClear()

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)

      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.sendMessageDraft).toHaveBeenCalledOnce()

      vi.restoreAllMocks()
    })

    it('skips update when content is unchanged', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Same', sessionId: 'sess-1' })
      api.sendMessageDraft.mockClear()

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)

      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Same', sessionId: 'sess-1' })

      expect(ok).toBe(true)
      expect(api.sendMessageDraft).not.toHaveBeenCalled()

      vi.restoreAllMocks()
    })
  })

  // ── sendUpdate — concurrency guard ──────────────────────────────────────

  describe('sendUpdate — concurrency guard', () => {
    it('updates during inflight are buffered rather than sent concurrently', async () => {
      // First update creates the draft
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })

      // Advance past throttle window
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)

      // Make sendMessageDraft slow
      let resolveDraft!: () => void
      api.sendMessageDraft.mockImplementationOnce(() =>
        new Promise<void>((resolve) => { resolveDraft = resolve })
      )

      // Start an inflight send (don't await yet)
      const sendPromise = strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(2) // initial + Step 2

      // Another update while inflight — should NOT start a second API call
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 3', sessionId: 'sess-1' })
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(2) // still only 2

      // Complete the inflight call — pending content should be flushed
      resolveDraft()
      await sendPromise

      // Pending content (Step 3) should now be sent
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(3)
      const lastCall = api.sendMessageDraft.mock.calls[2]
      expect(lastCall[2]).toBe('Step 3')

      vi.restoreAllMocks()
    })

    it('multiple pending updates — only latest is flushed', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)

      // Slow send for Step 2
      let resolveStep2!: () => void
      api.sendMessageDraft.mockImplementationOnce(() =>
        new Promise<void>((resolve) => { resolveStep2 = resolve })
      )

      const p2 = strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      // Step 3 and Step 4 arrive while Step 2 is inflight
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 3', sessionId: 'sess-1' })
      await strategy.sendUpdate({ chatId: '42', content: 'Step 4', sessionId: 'sess-1' })

      // Complete Step 2
      resolveStep2()
      await p2

      // Should have flushed only Step 4 (latest)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(3) // initial + Step 2 + Step 4
      const lastCall = api.sendMessageDraft.mock.calls[2]
      expect(lastCall[2]).toBe('Step 4')

      vi.restoreAllMocks()
    })
  })

  // ── sendUpdate — degradation protocol ───────────────────────────────────────

  describe('sendUpdate — degradation protocol', () => {
    it('first sendMessageDraft failure returns false (degradation signal)', async () => {
      api.sendMessageDraft.mockRejectedValueOnce(new Error('API not available'))

      const ok = await strategy.sendUpdate({
        chatId: '42',
        content: 'Hello',
        sessionId: 'sess-1',
      })

      expect(ok).toBe(false)
      expect(strategy.hasActive('42')).toBe(false)
    })

    it('subsequent sendMessageDraft failure returns true (no mid-session degradation)', async () => {
      // First call succeeds
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      expect(strategy.hasActive('42')).toBe(true)

      // Advance time
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)

      // Subsequent failure
      api.sendMessageDraft.mockRejectedValueOnce(new Error('temporary error'))
      const ok = await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })

      expect(ok).toBe(true) // no degradation
      expect(strategy.hasActive('42')).toBe(true) // state preserved

      vi.restoreAllMocks()
    })
  })

  // ── sendUpdate — draftId ─────────────────────────────────────────────────

  describe('sendUpdate — draftId', () => {
    it('draftId is always a positive non-zero integer', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Hello', sessionId: 'sess-1' })

      const [, draftId] = api.sendMessageDraft.mock.calls[0]
      expect(draftId).toBeGreaterThan(0)
      expect(Number.isInteger(draftId)).toBe(true)
    })

    it('draftId remains the same for the same chat (same draft update has animation)', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })
      const draftId1 = api.sendMessageDraft.mock.calls[0][1]

      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 500)
      await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })
      const draftId2 = api.sendMessageDraft.mock.calls[1][1]

      expect(draftId2).toBe(draftId1)

      vi.restoreAllMocks()
    })
  })

  // ── finalize ────────────────────────────────────────────────────────────

  describe('finalize', () => {
    it('always returns false (draft cannot be edited/replaced)', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })

      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: ['<b>Final</b>'],
      })

      expect(result).toBe(false)
    })

    it('cleans up state after finalize', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })
      expect(strategy.hasActive('42')).toBe(true)

      await strategy.finalize({ chatId: '42', htmlChunks: ['<b>Final</b>'] })
      expect(strategy.hasActive('42')).toBe(false)
    })

    it('finalize also returns false when there is no active state (no error thrown)', async () => {
      const result = await strategy.finalize({
        chatId: '42',
        htmlChunks: ['<b>Final</b>'],
      })

      expect(result).toBe(false)
    })
  })

  // ── keep-alive ───────────────────────────────────────────────────────

  describe('keep-alive', () => {
    it('periodically resends content while draft is active to maintain visibility', async () => {
      vi.useFakeTimers()

      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(1)

      // Advance 4s — keep-alive should trigger resend
      await vi.advanceTimersByTimeAsync(4_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(2)

      // Verify resent content matches the last content
      const lastCall = api.sendMessageDraft.mock.calls[1]
      expect(lastCall[2]).toBe('Working...')

      // Advance another 4s — triggers again
      await vi.advanceTimersByTimeAsync(4_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(3)

      vi.useRealTimers()
    })

    it('keep-alive stops after release', async () => {
      vi.useFakeTimers()

      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })
      strategy.release('42')

      // Advance 8s — keep-alive should not trigger anymore
      await vi.advanceTimersByTimeAsync(8_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(1) // only the initial call

      vi.useRealTimers()
    })

    it('keep-alive stops after finalize', async () => {
      vi.useFakeTimers()

      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })
      await strategy.finalize({ chatId: '42', htmlChunks: ['<b>Final</b>'] })

      await vi.advanceTimersByTimeAsync(8_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(1) // only the initial call

      vi.useRealTimers()
    })

    it('keep-alive timer resets after new content update', async () => {
      vi.useFakeTimers()

      await strategy.sendUpdate({ chatId: '42', content: 'Step 1', sessionId: 'sess-1' })

      // Advance 3s (less than 4s, keep-alive not yet triggered)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(1) // only the initial call

      // Send new content — resets keep-alive timer
      await strategy.sendUpdate({ chatId: '42', content: 'Step 2', sessionId: 'sess-1' })
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(2)

      // Advance 3s from new content — keep-alive not yet triggered
      await vi.advanceTimersByTimeAsync(3_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(2) // no new calls

      // Advance another 1s (4s total) — keep-alive triggers
      await vi.advanceTimersByTimeAsync(1_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(3)

      vi.useRealTimers()
    })

    it('keep-alive failure does not affect state', async () => {
      vi.useFakeTimers()

      await strategy.sendUpdate({ chatId: '42', content: 'Working...', sessionId: 'sess-1' })

      // keep-alive call fails
      api.sendMessageDraft.mockRejectedValueOnce(new Error('network error'))
      await vi.advanceTimersByTimeAsync(4_000)

      // State is still preserved
      expect(strategy.hasActive('42')).toBe(true)

      // Next keep-alive works normally
      api.sendMessageDraft.mockResolvedValue(true)
      await vi.advanceTimersByTimeAsync(4_000)
      expect(api.sendMessageDraft).toHaveBeenCalledTimes(3) // initial + failed + success

      vi.useRealTimers()
    })
  })

  // ── release / releaseAll / hasActive ──────────────────────────────────

  describe('lifecycle management', () => {
    it('release cleans up the specified chatId', async () => {
      await strategy.sendUpdate({ chatId: '42', content: 'test', sessionId: 's1' })
      expect(strategy.hasActive('42')).toBe(true)

      strategy.release('42')
      expect(strategy.hasActive('42')).toBe(false)
    })

    it('releasing a non-existent chatId does not throw', () => {
      expect(() => strategy.release('nonexistent')).not.toThrow()
    })

    it('releaseAll cleans up all states', async () => {
      await strategy.sendUpdate({ chatId: '100', content: 'A', sessionId: 's1' })
      await strategy.sendUpdate({ chatId: '200', content: 'B', sessionId: 's2' })

      strategy.releaseAll()

      expect(strategy.hasActive('100')).toBe(false)
      expect(strategy.hasActive('200')).toBe(false)
    })

    it('different chatIds do not affect each other', async () => {
      await strategy.sendUpdate({ chatId: '100', content: 'A', sessionId: 's1' })
      await strategy.sendUpdate({ chatId: '200', content: 'B', sessionId: 's2' })

      strategy.release('100')

      expect(strategy.hasActive('100')).toBe(false)
      expect(strategy.hasActive('200')).toBe(true)
    })
  })
})
