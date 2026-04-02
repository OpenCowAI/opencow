// SPDX-License-Identifier: Apache-2.0

/**
 * ChatContextManager — per-chat ephemeral state for Telegram Bot interactions.
 *
 * Stores two kinds of temporary state per (botId, chatId) pair:
 *   - `mode`: current conversation flow mode (e.g. waiting for Issue description)
 *   - `activeProjectId` / `activeProjectName`: user's temporarily selected project
 *
 * Lifecycle:
 *   - State is kept in memory only — cleared on Bot restart (intentional).
 *   - The composite key `${botId}:${chatId}` ensures multi-Bot isolation:
 *     Bot A and Bot B with the same chatId maintain independent state.
 */

/** per-chat temporary state (in-memory, cleared on Bot restart) */
interface ChatContext {
  /** Current conversation flow mode */
  mode: 'normal' | 'issue_creation'
  /** User's temporarily switched project name (for display purposes) */
  activeProjectName?: string
  /** User's temporarily switched project ID (used for IssueService filter) */
  activeProjectId?: string
}

const DEFAULT_CONTEXT: ChatContext = { mode: 'normal' }

export class ChatContextManager {
  private readonly contexts = new Map<string, ChatContext>()

  /**
   * Composite key — supports multi-Bot scenarios.
   * Same chatId under different Bots maintains independent state.
   */
  private key(botId: string, chatId: string): string {
    return `${botId}:${chatId}`
  }

  /** Get the context for a (botId, chatId) pair. Returns default if not set. */
  get(botId: string, chatId: string): ChatContext {
    return this.contexts.get(this.key(botId, chatId)) ?? { ...DEFAULT_CONTEXT }
  }

  /** Partially update the context, preserving unspecified fields. */
  patch(botId: string, chatId: string, patch: Partial<ChatContext>): void {
    const current = this.get(botId, chatId)
    this.contexts.set(this.key(botId, chatId), { ...current, ...patch })
  }

  /** Reset context to defaults (e.g. after mode completes or on /cancel). */
  reset(botId: string, chatId: string): void {
    this.contexts.delete(this.key(botId, chatId))
  }
}
