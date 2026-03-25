// SPDX-License-Identifier: Apache-2.0

/**
 * Unified IM Bot command routing (platform-agnostic)
 *
 * Conversation model (natural language first):
 *   - Plain text / unknown command → 'chat' (continue current session; create new if none active)
 *   - /new [prompt]      → 'new'   (force start a brand new session)
 *   - /clear             → 'clear' (terminate current session; next message starts fresh)
 *   - /stop [id]         → 'stop'  (stop specified or current session)
 *   - /ask [prompt]      → 'new'   (alias for /new, backward compatible)
 *   - /reply <id> <msg>  → 'reply' (reserved for precise control when needed)
 *   - /menu              → 'menu'  (interactive menu panel)
 *   - /help /start       → 'help'  (plain text help information)
 *
 * Used by: TelegramBotService, FeishuBotService, DiscordBotService
 */
export type CommandAction =
  | 'chat'    // Continue current session (primary entry point)
  | 'new'     // Explicitly start a new session
  | 'clear'   // Terminate current session
  | 'status'
  | 'sessions'
  | 'stop'
  | 'reply'
  | 'issues'
  | 'inbox'
  | 'menu'    // Interactive menu panel
  | 'help'    // Plain text help information

export interface RouteResult {
  action: CommandAction
  args: Record<string, string>
}

export class CommandRouter {
  parse(raw: string): RouteResult {
    const text = raw.trim()
    if (!text) return { action: 'help', args: {} }

    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ')
      const cmdPart = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)
      const rest = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim()

      // Strip @botname suffix (Telegram/Feishu append @bot_username in group chats)
      const command = cmdPart.split('@')[0].toLowerCase()

      switch (command) {
        case 'status':
          return { action: 'status', args: {} }
        case 'sessions':
          return { action: 'sessions', args: {} }

        // Explicitly start a new session
        case 'new':
        case 'ask':
          return { action: 'new', args: { prompt: rest } }

        // Clear current session context
        case 'clear':
          return { action: 'clear', args: {} }

        case 'stop':
          return { action: 'stop', args: { sessionId: rest } }

        // Precise directed reply (reserved, not the primary usage path)
        case 'reply': {
          const idx = rest.indexOf(' ')
          if (idx === -1) return { action: 'reply', args: { sessionId: rest, message: '' } }
          return {
            action: 'reply',
            args: { sessionId: rest.slice(0, idx), message: rest.slice(idx + 1).trim() },
          }
        }

        case 'issues':
          return { action: 'issues', args: {} }
        case 'inbox':
          return { action: 'inbox', args: {} }

        case 'menu':
          return { action: 'menu', args: {} }

        case 'help':
        case 'start':
          return { action: 'help', args: {} }

        default:
          // Unknown slash command → treat as chat content to continue session
          return { action: 'chat', args: { prompt: text } }
      }
    }

    // Plain text → continue current session
    return { action: 'chat', args: { prompt: text } }
  }
}
