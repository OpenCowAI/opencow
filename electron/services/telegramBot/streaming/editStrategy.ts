// SPDX-License-Identifier: Apache-2.0

/**
 * Edit Streaming Strategy — streaming via sendMessage + editMessageText.
 *
 * This is the classic Telegram Bot streaming approach, extracted as-is from
 * TelegramBotService.handleAssistantMessage(). Supports all Telegram chat types
 * (private, group, channel).
 *
 * Lifecycle:
 *   1. sendUpdate (first)       → sendMessage creates placeholder bubble with stop button
 *   2. sendUpdate (subsequent)  → editMessageText throttled updates (1000ms), keeps button
 *   3. finalize                 → editMessageText replaces with final HTML, removes button
 *   4. release                  → deletes internal state
 *
 * Throttle strategy:
 *   - 1000ms minimum interval (Telegram editMessageText rate limit ~1/sec)
 *   - Skips edit when content is unchanged (avoids "message is not modified" error)
 *   - Each successful edit followed by sendChatAction('typing') to refresh top-bar indicator
 *
 * Concurrency safety:
 *   - At most one editMessageText in flight per chat at a time
 *   - Updates during inflight are buffered in pendingContent, flushed immediately on completion
 *   - Prevents content flash-back caused by out-of-order API completion under high proxy latency
 */

import type { Api } from 'grammy'
import type { StreamingStrategy, StreamingUpdateParams, FinalizeParams } from './types'
import { safeContent } from './types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('EditStreamingStrategy')

/** Minimum interval between editMessageText calls */
const EDIT_THROTTLE_MS = 1000

/** Per-chat placeholder message state */
interface EditState {
  tgMessageId: number
  lastEditAt: number
  /** Last content sent to Telegram — skip edit when content is unchanged */
  lastContent: string
  /** Stop button callback_data, cached to avoid recalculation */
  stopCallbackData: string
  /**
   * Guards against concurrent editMessageText API calls.
   *
   * Telegram API round-trips can take 200ms–2000ms (especially through a proxy).
   * When latency exceeds the throttle window (1000ms), a second editMessageText
   * can be dispatched while the first is still in flight. If the later call
   * completes before the earlier one, the bubble is overwritten with OLDER
   * content — causing a visible "flash-back" regression.
   *
   * With this flag, only one editMessageText per chat is in flight at a time.
   * Updates arriving while inflight are saved in `pendingContent` and flushed
   * after the current call completes.
   */
  inflight: boolean
  /** Deferred content — latest update received while `inflight` was true. */
  pendingContent: string | null
}

export class EditStreamingStrategy implements StreamingStrategy {
  private readonly states = new Map<string, EditState>()

  constructor(
    private readonly api: Api,
    private readonly onMessageSent: () => void,
  ) {}

  async sendUpdate(params: StreamingUpdateParams): Promise<boolean> {
    const { chatId, sessionId } = params
    const content = safeContent(params.content)
    const existing = this.states.get(chatId)

    if (!existing) {
      // ── First call: create placeholder bubble + stop button ────────────
      try {
        const stopCallbackData = `stop:${sessionId}`
        const sent = await this.api.sendMessage(chatId, content, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⏹️ Stop', callback_data: stopCallbackData }]],
          },
        })
        this.states.set(chatId, {
          tgMessageId: sent.message_id,
          lastEditAt: Date.now(),
          lastContent: content,
          stopCallbackData,
          inflight: false,
          pendingContent: null,
        })
        this.onMessageSent()
        return true
      } catch (err) {
        log.warn('Failed to send streaming placeholder message', err instanceof Error ? err.message : String(err))
        return false
      }
    }

    // ── Subsequent: throttled edit update ──────────────────────────────
    const now = Date.now()
    if (now - existing.lastEditAt < EDIT_THROTTLE_MS) return true
    if (content === existing.lastContent) return true

    // Concurrency guard: if an API call is already in flight, save latest
    // content for deferred flush. This prevents out-of-order API completion
    // from overwriting newer content with older content ("flash-back" bug).
    if (existing.inflight) {
      existing.pendingContent = content
      return true
    }

    await this.doEdit(chatId, existing, content)
    return true
  }

  /**
   * Serially execute editMessageText, then flush any deferred content.
   *
   * After each API call completes, checks if newer content was saved while
   * the call was in flight. If so, immediately sends the latest version.
   * This ensures the bubble always converges to the most recent content
   * without out-of-order overwrites.
   */
  private async doEdit(chatId: string, state: EditState, content: string): Promise<void> {
    state.inflight = true
    state.lastEditAt = Date.now()

    try {
      await this.api.editMessageText(chatId, state.tgMessageId, content, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '⏹️ Stop', callback_data: state.stopCallbackData }]],
        },
      })
      state.lastContent = content
    } catch (editErr) {
      // Placeholder message was deleted by user — clean up stale state, next event creates a new bubble
      const tgErr = editErr as { error_code?: number; description?: string }
      if (tgErr.error_code === 400 && String(tgErr.description ?? '').includes('to edit not found')) {
        this.states.delete(chatId)
        state.inflight = false
        state.pendingContent = null
        return
      }
      // Other errors (rate limit, network) — silently ignore, mark content as sent to avoid retry loops
      state.lastContent = content
    }

    state.inflight = false

    // Refresh top-bar "typing..." indicator (expires every ~5s).
    this.api.sendChatAction(chatId, 'typing').catch(() => {})

    // Flush deferred content: if newer content arrived while we were in flight,
    // send it immediately (no throttle — the current call just finished).
    const pending = state.pendingContent
    if (pending && pending !== state.lastContent) {
      state.pendingContent = null
      await this.doEdit(chatId, state, pending)
    } else {
      state.pendingContent = null
    }
  }

  async finalize(params: FinalizeParams): Promise<boolean> {
    const { chatId, htmlChunks } = params
    if (htmlChunks.length === 0) return true

    const existing = this.states.get(chatId)
    this.states.delete(chatId)

    if (!existing) return false // No active bubble → caller must sendMessage itself

    // Cancel any pending deferred content — finalize takes priority
    existing.pendingContent = null

    try {
      await this.api.editMessageText(chatId, existing.tgMessageId, htmlChunks[0], {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [] }, // Remove stop button
      })
      return true // First chunk replaced, caller only needs to send remaining chunks
    } catch (err) {
      log.warn('Failed to replace streaming placeholder, caller will send new messages', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  release(chatId: string): void {
    this.states.delete(chatId)
  }

  hasActive(chatId: string): boolean {
    return this.states.has(chatId)
  }

  releaseAll(): void {
    this.states.clear()
  }
}
