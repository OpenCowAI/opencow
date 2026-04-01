// SPDX-License-Identifier: Apache-2.0

/**
 * StreamingMessageBuffer — O(1) write buffer for the streaming assistant message.
 *
 * During streaming, the for-await loop in the effect projector updates the
 * current assistant message 3-5× per SDK event (updateBlocks, setActiveToolUseId,
 * appendToolProgress).  Each of those previously called ManagedSession methods
 * that do `messages.find(m => m.id === id)` — O(M) linear scans.
 *
 * This buffer holds a **direct reference** to the message object inside
 * `ManagedSession.messages[]`.  All mutations go through the buffer at O(1).
 * The shared reference means ManagedSession sees the mutations immediately
 * (same object in memory).
 *
 * `getSnapshot()` produces a shallow copy for IPC dispatch (Electron
 * structured-clone requires a fresh object each time).
 *
 * Lifecycle: begin() → updateBlocks/appendToolProgress/setActiveToolUseId → finalize()
 */

import type { ContentBlock, ManagedSessionMessage, ToolUseBlock } from '../../src/shared/types'
import { IPC_PROGRESS_CAP_CHARS } from '../conversation/constants'

type AssistantMessage = Extract<ManagedSessionMessage, { role: 'assistant' }>

export class StreamingMessageBuffer {
  /** Direct reference into ManagedSession.messages[] — same object, not a copy. */
  private _message: AssistantMessage | null = null

  /**
   * Cached reference to the last tool_use block that received progress.
   * Avoids O(N) content.find() on consecutive appendToolProgress calls
   * for the same toolUseId (the common case during tool execution).
   */
  private _activeToolBlock: ToolUseBlock | null = null
  private _activeToolBlockId: string | null = null

  /**
   * Begin tracking a streaming message.
   *
   * @param msg Direct reference obtained from `ManagedSession.getLastMessageRef()`
   *            immediately after `addMessage()`.  MUST be the same object that
   *            lives in `ManagedSession.messages[]`.
   */
  begin(msg: ManagedSessionMessage): void {
    if (msg.role !== 'assistant') return
    this._message = msg as AssistantMessage
    this._activeToolBlock = null
    this._activeToolBlockId = null
  }

  /** Whether the buffer is actively tracking a streaming message. */
  get isActive(): boolean {
    return this._message !== null
  }

  /** The tracked message ID, or null if inactive. */
  get messageId(): string | null {
    return this._message?.id ?? null
  }

  /**
   * Replace the content blocks on the tracked message — O(1) direct mutation.
   *
   * IMPORTANT: This mutates the referenced object directly (`this._message.content = blocks`).
   * It does NOT create a new object via spread.  The reference to the object inside
   * `ManagedSession.messages[]` is preserved.
   */
  updateBlocks(blocks: ContentBlock[]): void {
    if (!this._message) return
    this._message.content = blocks
    this._message.isStreaming = true
    // Invalidate tool block cache — blocks array was replaced
    this._activeToolBlock = null
    this._activeToolBlockId = null
  }

  /**
   * Set the activeToolUseId on the tracked message — O(1) direct mutation.
   */
  setActiveToolUseId(toolUseId: string | null): void {
    if (!this._message) return
    this._message.activeToolUseId = toolUseId
  }

  /**
   * Append tool progress text to a tool_use block — O(1) amortized.
   *
   * Uses a cached reference to the last matched tool block.  Consecutive
   * calls with the same `toolUseId` (the overwhelmingly common pattern
   * during tool execution) hit the cache and skip the content.find() scan.
   *
   * Cache miss (different toolUseId or first call) falls back to a linear
   * scan, then caches the result for subsequent calls.
   */
  appendToolProgress(toolUseId: string, chunk: string): void {
    if (!this._message) return

    // Fast path: cache hit — same toolUseId as last call
    if (this._activeToolBlockId === toolUseId && this._activeToolBlock) {
      this._activeToolBlock.progress = (this._activeToolBlock.progress ?? '') + chunk
      return
    }

    // Slow path: linear scan + cache update
    const block = this._message.content.find(
      (b): b is ToolUseBlock => b.type === 'tool_use' && b.id === toolUseId,
    )
    if (block) {
      this._activeToolBlock = block
      this._activeToolBlockId = toolUseId
      block.progress = (block.progress ?? '') + chunk
    }
  }

  /**
   * Produce a shallow copy of the tracked message for IPC dispatch,
   * with oversized `progress` strings truncated to {@link IPC_PROGRESS_CAP_CHARS}.
   *
   * tool.progress accumulates to 50-200 KB during long tool executions,
   * but the renderer only displays the last 8000 characters.  Truncating
   * at the IPC boundary reduces structured-clone cost from 1-5 ms to
   * <0.1 ms per dispatch.
   *
   * When no tool_use block exceeds the cap, the fast path returns a plain
   * shallow copy with zero content-array overhead.
   */
  getSnapshot(): ManagedSessionMessage | null {
    if (!this._message) return null
    // Fast check: any tool_use block over the cap?
    let needsTrim = false
    for (const block of this._message.content) {
      if (block.type === 'tool_use' && block.progress && block.progress.length > IPC_PROGRESS_CAP_CHARS) {
        needsTrim = true
        break
      }
    }
    if (!needsTrim) return { ...this._message }
    // Slow path: create trimmed content — only copies blocks that exceed the cap
    const content = this._message.content.map((block) => {
      if (block.type === 'tool_use' && block.progress && block.progress.length > IPC_PROGRESS_CAP_CHARS) {
        return { ...block, progress: block.progress.slice(-IPC_PROGRESS_CAP_CHARS) }
      }
      return block
    })
    return { ...this._message, content }
  }

  /**
   * Finalize the buffer — clear internal state.
   *
   * Called after the last throttle flush and before `StreamState.finalizeStreaming()`.
   * Returns the messageId that was being tracked (for callers that need it).
   */
  finalize(): string | null {
    const id = this._message?.id ?? null
    this._message = null
    this._activeToolBlock = null
    this._activeToolBlockId = null
    return id
  }

  /** Hard reset — used in `SessionContext.dispose()`. */
  clear(): void {
    this._message = null
    this._activeToolBlock = null
    this._activeToolBlockId = null
  }
}
