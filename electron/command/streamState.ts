// SPDX-License-Identifier: Apache-2.0

/**
 * Encapsulates the mutable streaming state within a session's event loop.
 *
 * In the old `runSession()`, these were bare closure variables:
 *   - `streamingMessageId: string | null`
 *   - `partialBlockCount: number` (used for block-count throttle)
 *
 * StreamState replaces them with semantic methods:
 *   - `beginStreaming(id)` / `finalizeStreaming()` — state machine transitions
 *
 * No raw fields are exposed. Illegal state transitions are impossible.
 */
export class StreamState {
  private _streamingMessageId: string | null = null

  /** Start tracking a new streaming message. */
  beginStreaming(messageId: string): void {
    this._streamingMessageId = messageId
  }

  /**
   * Finalize the current streaming message.
   * Returns the messageId that was being tracked (or null if not streaming).
   * Resets all streaming state.
   */
  finalizeStreaming(): string | null {
    const id = this._streamingMessageId
    this._streamingMessageId = null
    return id
  }

  /** The message ID currently being streamed, or null. */
  get streamingMessageId(): string | null {
    return this._streamingMessageId
  }

  /** Whether a streaming message is currently in progress. */
  get isStreaming(): boolean {
    return this._streamingMessageId !== null
  }
}
