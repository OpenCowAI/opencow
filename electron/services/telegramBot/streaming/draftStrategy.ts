// SPDX-License-Identifier: Apache-2.0

/**
 * Draft Streaming Strategy — streaming via sendMessageDraft (Bot API 9.5+).
 *
 * Uses Telegram's native draft message mechanism for streaming replies,
 * providing a ChatGPT-like typewriter animation. Compared to the Edit strategy:
 *   - Native animation transitions (same draftId updates have smooth animations)
 *   - No "edited" tag
 *   - Lighter server-side overhead (drafts don't create persistent messages)
 *
 * Limitations:
 *   - Private chats only (chat_id must be a positive integer)
 *   - No reply_markup support (no stop button during streaming; users can use /stop)
 *   - Does not return message_id (cannot track/edit draft messages)
 *   - Cannot edit-replace on finalize; caller must sendMessage for final content
 *
 * Lifecycle:
 *   1. sendUpdate (first)       → sendMessageDraft creates draft
 *   2. sendUpdate (subsequent)  → sendMessageDraft updates (300ms throttle, same draftId animates)
 *   3. finalize                 → clean up state, return false (caller sends final content)
 *   4. release                  → clean up state
 *
 * Degradation protocol:
 *   - First sendUpdate failure (invalid chatId, API unavailable) → return false, caller degrades to Edit
 *   - Subsequent sendUpdate failures → return true (avoid mid-stream switching to prevent duplicates)
 *
 * Concurrency safety:
 *   - At most one sendMessageDraft in flight per chat at a time
 *   - Updates during inflight are buffered in pendingContent, flushed immediately on completion
 *   - Prevents content flash-back caused by out-of-order API completion under high proxy latency
 */

import type { Api } from 'grammy'
import type { StreamingStrategy, StreamingUpdateParams, FinalizeParams } from './types'
import { safeContent } from './types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('DraftStreamingStrategy')

/**
 * Throttle interval for sendMessageDraft.
 *
 * Drafts are lighter than editMessageText (no server-side persistence), allowing
 * more frequent updates for smoother typewriter effect. Throttling is still needed
 * to avoid Telegram rate limits.
 */
const DRAFT_THROTTLE_MS = 300

/**
 * Draft keep-alive refresh interval (milliseconds).
 *
 * Telegram clients auto-hide draft messages after a few seconds without updates.
 * During gaps with no new content (e.g. tool calls), the same content must be
 * periodically re-sent to keep the draft bubble visible. 4s is safely below
 * Telegram's auto-hide threshold.
 */
const DRAFT_KEEPALIVE_MS = 4_000

/** Per-chat draft state */
interface DraftState {
  numericChatId: number
  draftId: number
  lastSendAt: number
  lastContent: string
  /** Whether the first sendMessageDraft has succeeded — used to decide whether to degrade on failure */
  established: boolean
  /** Concurrency guard — see EditStrategy.EditState.inflight for rationale. */
  inflight: boolean
  /** Deferred content — latest update received while `inflight` was true. */
  pendingContent: string | null
}

export class DraftStreamingStrategy implements StreamingStrategy {
  private readonly states = new Map<string, DraftState>()
  /**
   * Per-chat keep-alive timers — periodically re-send the draft to prevent
   * Telegram from auto-hiding it during content gaps (e.g. tool execution).
   */
  private readonly keepAliveTimers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(private readonly api: Api) {}

  async sendUpdate(params: StreamingUpdateParams): Promise<boolean> {
    const { chatId } = params
    const content = safeContent(params.content)

    // Draft only supports private chats (positive integer chatId).
    // Group chatIds are negative; supergroup chatIds have a -100 prefix.
    const numericChatId = Number(chatId)
    if (!Number.isFinite(numericChatId) || numericChatId <= 0) {
      return false
    }

    const existing = this.states.get(chatId)

    if (!existing) {
      // ── First call: create draft ────────────────────────────────────────
      const draftId = generateDraftId()

      try {
        await this.api.sendMessageDraft(numericChatId, draftId, content)
        this.states.set(chatId, {
          numericChatId,
          draftId,
          lastSendAt: Date.now(),
          lastContent: content,
          established: true,
          inflight: false,
          pendingContent: null,
        })
        this.startKeepAlive(chatId)
        return true
      } catch (err) {
        log.warn('sendMessageDraft first call failed', err instanceof Error ? err.message : String(err))
        return false // Degradation signal → caller switches to Edit strategy
      }
    }

    // ── Subsequent: throttled update ──────────────────────────────────────
    const now = Date.now()
    if (now - existing.lastSendAt < DRAFT_THROTTLE_MS) return true
    if (content === existing.lastContent) return true

    // Concurrency guard — same pattern as EditStrategy
    if (existing.inflight) {
      existing.pendingContent = content
      return true
    }

    await this.doSendDraft(chatId, existing, content)
    return true
  }

  /**
   * Serially execute sendMessageDraft, then flush any deferred content.
   *
   * Same serial guarantee as EditStrategy.doEdit — no concurrent API calls
   * per chat, deferred content is flushed immediately after completion.
   */
  private async doSendDraft(chatId: string, state: DraftState, content: string): Promise<void> {
    state.inflight = true
    state.lastSendAt = Date.now()

    try {
      await this.api.sendMessageDraft(state.numericChatId, state.draftId, content)
      state.lastContent = content
      // Content update succeeded → reset keep-alive timer (avoid re-sending immediately after update)
      this.startKeepAlive(chatId)
    } catch (err) {
      // Subsequent failures don't degrade (avoid mid-stream switching that causes duplicate messages).
      // Temporary network errors for drafts don't affect final message delivery.
      log.warn('sendMessageDraft update failed', err instanceof Error ? err.message : String(err))
      // Mark as sent to prevent retry loop on persistent errors
      state.lastContent = content
    }

    state.inflight = false

    // Flush deferred content
    const pending = state.pendingContent
    if (pending && pending !== state.lastContent) {
      state.pendingContent = null
      await this.doSendDraft(chatId, state, pending)
    } else {
      state.pendingContent = null
    }
  }

  async finalize(_params: FinalizeParams): Promise<boolean> {
    const { chatId } = _params
    this.stopKeepAlive(chatId)
    const state = this.states.get(chatId)
    if (state) state.pendingContent = null // Cancel deferred content
    this.states.delete(chatId)

    // Drafts have no message_id, so they cannot be replaced via editMessageText.
    // Return false to tell the caller: it must sendMessage all HTML chunks itself.
    // Telegram clients automatically discard the draft upon receiving a new sendMessage.
    return false
  }

  release(chatId: string): void {
    this.stopKeepAlive(chatId)
    this.states.delete(chatId)
  }

  hasActive(chatId: string): boolean {
    return this.states.has(chatId)
  }

  releaseAll(): void {
    this.keepAliveTimers.forEach((timer) => clearInterval(timer))
    this.keepAliveTimers.clear()
    this.states.clear()
  }

  // ── Keep-alive mechanism ─────────────────────────────────────────────

  /**
   * Start (or restart) a keep-alive timer for a chat.
   *
   * Telegram clients auto-hide draft messages after a few seconds without updates.
   * During gaps with no new content (e.g. tool calls), keep-alive periodically
   * re-sends the same content to keep the draft visible.
   *
   * The timer is reset on each content update to avoid sending a keep-alive
   * immediately after a real update.
   */
  private startKeepAlive(chatId: string): void {
    this.stopKeepAlive(chatId) // Clear old timer

    const timer = setInterval(() => {
      const state = this.states.get(chatId)
      if (!state) {
        this.stopKeepAlive(chatId)
        return
      }
      // Re-send the same content to keep the draft visible
      this.api.sendMessageDraft(state.numericChatId, state.draftId, state.lastContent)
        .then(() => {
          state.lastSendAt = Date.now()
        })
        .catch((err) => {
          // Keep-alive failure doesn't affect the main flow, log only
          log.debug('draft keep-alive refresh failed', err instanceof Error ? err.message : String(err))
        })
    }, DRAFT_KEEPALIVE_MS)

    this.keepAliveTimers.set(chatId, timer)
  }

  private stopKeepAlive(chatId: string): void {
    const timer = this.keepAliveTimers.get(chatId)
    if (timer !== undefined) {
      clearInterval(timer)
      this.keepAliveTimers.delete(chatId)
    }
  }
}

/**
 * Generate a draft_id.
 *
 * Requirements: non-zero positive integer (Telegram API constraint "must be non-zero").
 * Consecutive updates with the same draftId produce smooth animations in Telegram clients.
 * Different draftIds represent new draft messages.
 *
 * Uses the low 31 bits of the current timestamp to ensure:
 *   1. Positive integer (bit 31 = 0)
 *   2. Non-zero (|| 1 fallback)
 *   3. Low collision probability across different sessions for the same chat
 */
function generateDraftId(): number {
  return (Date.now() & 0x7FFFFFFF) || 1
}
