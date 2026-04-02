// SPDX-License-Identifier: Apache-2.0

import { Bot, Context, HttpError } from 'grammy'
import type {
  TelegramBotEntry,
  TelegramBotStatus,
  IMConnectionStatusType,
  IMOrchestratorDeps,
  DataBusEvent,
  SessionSnapshot,
  ManagedSessionMessage,
  SessionOrigin,
  SessionWorkspaceInput,
  UserMessageContent,
} from '../../../src/shared/types'
import { CommandRouter } from '../messaging/commandRouter'
import { MessageFormatter, type FormattedMessage } from './messageFormatter'
import { createLogger } from '../../platform/logger'
import type { IssueService } from '../issueService'
import type { ProjectService } from '../projectService'
import { ChatContextManager } from './state/chatContextManager'
import { IssueHandler } from './handlers/issueHandler'
import { ProjectHandler } from './handlers/projectHandler'
import type { StreamingStrategy } from './streaming/types'
import { EditStreamingStrategy } from './streaming/editStrategy'
import { DraftStreamingStrategy } from './streaming/draftStrategy'
import { snapToGraphemeBoundary } from '@shared/unicode'
import { findActiveIMSession, routeIMMessage } from '../messaging/sessionRouter'
import { executeCommand, resolveSessionId, type CommandResult, type CommandContext } from '../messaging/commandHandler'
import { resolveUserWorkspaceBinding } from '../messaging/workspaceBinding'

const log = createLogger('TelegramBot')

/**
 * Unwrap grammy's HttpError to expose the actual network-layer error.
 * grammy wraps every fetch() throw in an HttpError; the original error
 * (e.g. `net::ERR_PROXY_CONNECTION_FAILED`) lives in `HttpError.error`.
 * Without unwrapping, logs only show "[HTTP] Failed: Network request … failed!"
 * which provides zero actionable information.
 */
function unwrapError(err: unknown): string {
  if (err instanceof HttpError) {
    const cause = err.error
    const causeMsg = cause instanceof Error ? cause.message : (cause ? String(cause) : undefined)
    return causeMsg ?? err.message
  }
  return err instanceof Error ? err.message : String(err)
}

/** Race a promise against a timeout. Rejects with the given message on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

type Dispatch = (event: DataBusEvent) => void

export interface TelegramBotServiceDeps {
  dispatch: Dispatch
  /**
   * Returns the current configuration for this bot instance.
   * Called on every operation — callers should return a live reference so that
   * hot-updatable fields (allowedUserIds, defaultWorkspace) take effect
   * without restarting the bot. Only `botToken` changes require stop + restart.
   */
  getConfig: () => TelegramBotEntry
  /**
   * Fetch function for Telegram API calls.  The caller is responsible for
   * proxy configuration (e.g. wrapping undici's fetch with a ProxyAgent).
   * When omitted, `globalThis.fetch` is used — suitable for environments
   * where the network stack is already proxy-aware or no proxy is needed.
   */
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  /** Issue management service — used by IssueHandler and IssueNativeCapability */
  issueService: IssueService
  /** Project management service — used by ProjectHandler */
  projectService: ProjectService
}

export class TelegramBotService {
  private bot: Bot | null = null
  private router = new CommandRouter()
  private fmt = new MessageFormatter()

  // ── per-chat ephemeral state (mode + activeProject) ──────────────────
  private readonly chatContext = new ChatContextManager()
  private readonly issueHandler: IssueHandler
  private readonly projectHandler: ProjectHandler

  private connectionStatus: IMConnectionStatusType = 'disconnected'
  private connectedAt: number | null = null
  private lastError: string | null = null

  /**
   * Dual streaming strategies — encapsulate how streaming updates are delivered
   * to the Telegram chat. Draft is preferred for private chats (native typing
   * animation, no "edited" tag); Edit is the universal fallback for all chat types.
   *
   * Both are shared between handleAssistantMessage() and handleEvoseProgress() —
   * the same per-chat bubble is reused across both, ensuring seamless
   * transitions between Evose progress and Claude text output.
   *
   * Initialized in start() after the Bot instance is ready.
   * Nulled in stop() when the Bot shuts down.
   */
  private editStrategy: EditStreamingStrategy | null = null
  private draftStrategy: DraftStreamingStrategy | null = null

  /**
   * Tracks the last Evose progress HTML content per chat.
   *
   * When `handleEvoseProgress()` updates a placeholder with Evose activity,
   * the content is saved here. When `handleAssistantMessage(isStreaming=true)`
   * is about to overwrite the placeholder with Claude's streaming text,
   * it first "commits" the saved Evose content as a permanent message —
   * preserving the agent name, tool call summary, and text output.
   *
   * Without this, the Evose progress would be silently overwritten and lost.
   */
  private lastEvoseContent = new Map<string, string>()

  /**
   * Stores the full (untruncated) Evose commit HTML per chat.
   *
   * `lastEvoseContent` stores the truncated streaming placeholder (≤ 4000 chars)
   * used for real-time updates. This map stores the full commit HTML generated
   * by `evoseCommitHtml()` — which may exceed 4096 chars and will be split
   * into multiple Telegram messages at commit time.
   *
   * Both maps are updated together in `handleEvoseProgress()` and cleared
   * together in `commitEvoseProgress()` / `releaseStreamingState()` / `stop()`.
   */
  private lastEvoseCommitContent = new Map<string, string>()

  /**
   * Per-chat interval timers that periodically call sendChatAction('typing')
   * during tool execution gaps.
   *
   * Telegram's "typing…" top-bar indicator expires after ~5 s, but a single
   * tool call (Bash, WebFetch, Task sub-agent, …) can take 5–60 s. Without
   * a refresh, users see silence and assume the bot is stuck.
   *
   * Lifecycle:
   *   - Started  → after a tool-use turn is sent to Telegram
   *   - Stopped  → when the next streaming event arrives (streaming started)
   *                OR when the session ends / is released
   */
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>()

  /**
   * Tracks chats where the bot is waiting for the user to supply a new-session
   * prompt via a ForceReply interaction.
   *
   * Key:   chatId (string)
   * Value: message_id of the bot's ForceReply prompt (used for exact reply matching)
   *
   * State is intentionally ephemeral (lost on bot restart). If the user never
   * replies, the next plain-text message will consume the pending state and
   * start a new session — graceful degradation without any stuck state.
   */
  private pendingNewPrompts = new Map<string, number>()

  private botUsername: string | null = null
  private messagesReceived = 0
  private messagesSent = 0

  constructor(private deps: TelegramBotServiceDeps) {
    const botId = deps.getConfig().id

    this.issueHandler = new IssueHandler({
      issueService: deps.issueService,
      chatContext:  this.chatContext,
      botId,
      sendToChat: (chatId, msg) => this.sendToChat(chatId, msg),
      dispatchUserMessage: async (chatId, userId, text) => {
        const result = await this.handleCommand(text, userId, chatId)
        if (result) await this.sendToChat(chatId, result)
      },
    })

    this.projectHandler = new ProjectHandler({
      projectService: deps.projectService,
      chatContext:    this.chatContext,
      botId,
      sendToChat: (chatId, msg) => this.sendToChat(chatId, msg),
    })
  }

  getStatus(): TelegramBotStatus {
    return {
      botId: this.deps.getConfig().id,
      connectionStatus: this.connectionStatus,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      botUsername: this.botUsername,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
    }
  }

  async start(): Promise<void> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      this.lastError = 'Bot Token not configured'
      this.dispatchStatus()
      return
    }

    this.setStatus('connecting')
    this.dispatchStatus()

    try {
      this.bot = new Bot(config.botToken, {
        client: { ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}) },
      })

      // Register command handlers (grammY style)
      this.bot.command('menu', (ctx) => this.onCommand(ctx))  // Main menu panel (primary entry point)
      this.bot.command('start', (ctx) => this.onCommand(ctx))
      this.bot.command('help', (ctx) => this.onCommand(ctx))  // Backward-compatible alias
      this.bot.command('status', (ctx) => this.onCommand(ctx))
      this.bot.command('sessions', (ctx) => this.onCommand(ctx))
      this.bot.command('new', (ctx) => this.onCommand(ctx))
      this.bot.command('ask', (ctx) => this.onCommand(ctx))   // /ask → /new alias
      this.bot.command('clear', (ctx) => this.onCommand(ctx))
      this.bot.command('stop', (ctx) => this.onCommand(ctx))
      this.bot.command('reply', (ctx) => this.onCommand(ctx)) // Reserved for precise control
      this.bot.command('issues', (ctx) => this.onCommand(ctx))
      this.bot.command('inbox', (ctx) => this.onCommand(ctx))

      // Handle plain text messages (primary conversation entry: continue current session)
      this.bot.on('message:text', (ctx) => this.onCommand(ctx))

      // Handle photo messages (photo type: Telegram auto-compressed images)
      this.bot.on('message:photo', (ctx) => this.onPhotoMessage(ctx))

      // Handle voice messages (voice: Telegram recorded OGG/Opus; audio: user-uploaded audio files)
      this.bot.on('message:voice', (ctx) => this.onVoiceMessage(ctx))
      this.bot.on('message:audio', (ctx) => this.onVoiceMessage(ctx))

      // Handle InlineKeyboard callbacks (e.g. "Stop Session" button)
      this.bot.callbackQuery(/^stop:(.+)$/, async (ctx) => {
        const sessionId = ctx.match![1]
        // Extract chatId early — ctx type narrows inside conditional branches
        const cbChatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
        const fullId = await resolveSessionId(sessionId, this.deps.orchestrator)
        if (fullId) {
          await this.deps.orchestrator.stopSession(fullId)
          // Release any in-flight placeholder for this chat so the next request
          // gets a fresh bubble instead of trying to edit the now-stale one.
          this.releaseStreamingState(cbChatId)
          await ctx.answerCallbackQuery({ text: 'Session stopped' })
          await ctx.editMessageText(`\u23F9\uFE0F Session \`${this.fmt.escapeMd(sessionId)}\` stopped`, { parse_mode: 'MarkdownV2' })
        } else {
          await ctx.answerCallbackQuery({ text: 'Session not found' })
        }
      })

      // "New Topic" button — triggers the same ForceReply flow as /new
      this.bot.callbackQuery('cmd:new', async (ctx) => {
        const cbChatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
        try {
          await ctx.answerCallbackQuery({ text: 'Starting new topic...' })
          const msg = this.fmt.forceReplyMessage('💬 Enter your new topic:')
          const sent = await this.bot!.api.sendMessage(cbChatId, msg.text, {
            parse_mode: msg.parse_mode,
            reply_markup: msg.reply_markup,
            link_preview_options: { is_disabled: true },
          })
          this.pendingNewPrompts.set(cbChatId, sent.message_id)
          this.messagesSent++
        } catch (err) {
          log.warn('cmd:new callback handling failed', unwrapError(err))
          try { await ctx.answerCallbackQuery({ text: 'Operation failed, please send /new directly' }) } catch { /* ignore */ }
        }
      })

      // ── Help menu group button callbacks ──────────────────────────────────

      // Section headers (── 💬 Chat ── etc.): no action on click, just answer to prevent loading state
      this.bot.callbackQuery('noop', async (ctx) => {
        await ctx.answerCallbackQuery()
      })

      // cmd:clear — equivalent to /clear (clear active session for current chat)
      this.bot.callbackQuery('cmd:clear', async (ctx) => {
        const cbChatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
        const userId = ctx.from?.id ?? 0
        try {
          await ctx.answerCallbackQuery({ text: 'Clearing...' })
          const result = await this.handleCommand('/clear', userId, cbChatId)
          if (result) await this.sendToChat(cbChatId, result)
        } catch (err) {
          log.warn('cmd:clear callback handling failed', unwrapError(err))
          try { await ctx.answerCallbackQuery({ text: 'Operation failed, please send /clear' }) } catch { /* ignore */ }
        }
      })

      // cmd:stop — equivalent to /stop (stop active session for current chat)
      this.bot.callbackQuery('cmd:stop', async (ctx) => {
        const cbChatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
        const userId = ctx.from?.id ?? 0
        try {
          await ctx.answerCallbackQuery({ text: 'Stopping...' })
          const result = await this.handleCommand('/stop', userId, cbChatId)
          if (result) await this.sendToChat(cbChatId, result)
        } catch (err) {
          log.warn('cmd:stop callback handling failed', unwrapError(err))
          try { await ctx.answerCallbackQuery({ text: 'Operation failed, please send /stop' }) } catch { /* ignore */ }
        }
      })

      // cmd:status — equivalent to /status (show all session statuses)
      this.bot.callbackQuery('cmd:status', async (ctx) => {
        const cbChatId = String(ctx.callbackQuery.message?.chat?.id ?? 0)
        const userId = ctx.from?.id ?? 0
        try {
          await ctx.answerCallbackQuery()
          const result = await this.handleCommand('/status', userId, cbChatId)
          if (result) await this.sendToChat(cbChatId, result)
        } catch (err) {
          log.warn('cmd:status callback handling failed', unwrapError(err))
          try { await ctx.answerCallbackQuery({ text: 'Operation failed, please send /status' }) } catch { /* ignore */ }
        }
      })

      // ── Issues ────────────────────────────────────────────────────────────
      this.bot.callbackQuery('cmd:issues',               (ctx) => this.issueHandler.handleList(ctx))
      this.bot.callbackQuery('cmd:issues:new',           (ctx) => this.issueHandler.handleNew(ctx))
      this.bot.callbackQuery(/^cmd:issues:filter:(.+)$/, (ctx) => this.issueHandler.handleFilter(ctx))

      // ── Projects ──────────────────────────────────────────────────────────
      this.bot.callbackQuery('cmd:projects',                (ctx) => this.projectHandler.handleList(ctx))
      this.bot.callbackQuery('cmd:projects:switch',         (ctx) => this.projectHandler.handleSwitchPrompt(ctx))
      this.bot.callbackQuery(/^cmd:projects:switch:(.+)$/,  (ctx) => this.projectHandler.handleSwitch(ctx))

      // ── Initialize bot (get botInfo), with 15s timeout ────────────────
      await withTimeout(this.bot.init(), 15_000, 'Bot init (getMe) timed out')
      this.botUsername = this.bot.botInfo.username

      // Register command menu (non-blocking, failure doesn't affect startup)
      // /menu is the primary entry, listed first; /reply and other advanced commands are hidden from menu
      this.bot.api.setMyCommands([
        { command: 'menu',   description: '📋 Menu Panel' },
        { command: 'new',    description: '🆕 Start a new conversation' },
        { command: 'clear',  description: '🗑️ Clear current session, start fresh' },
        { command: 'stop',   description: '⏹️ Stop current session' },
        { command: 'status', description: '📋 View all session statuses' },
      ]).catch((err) => {
        log.warn('Failed to set menu commands (does not affect Bot operation)', err instanceof Error ? err.message : String(err))
      })

      // Start Long Polling — wait for onStart to fire (or timeout/error) before resolving
      // This ensures IPC `await tgBot.start()` returns with a determined status
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          this.bot!.start({
            onStart: () => {
              log.info(`Telegram Bot @${this.botUsername} started Long Polling`)
              this.setStatus('connected')
              this.connectedAt = Date.now()
              // Initialize streaming strategies now that bot.api is ready
              this.editStrategy = new EditStreamingStrategy(
                this.bot!.api,
                () => { this.messagesSent++ },
              )
              this.draftStrategy = new DraftStreamingStrategy(this.bot!.api)
              this.dispatchStatus()
              resolve()
            },
          }).catch((err) => {
            // Long Polling error during operation (network disconnected, token revoked, etc.)
            this.lastError = err instanceof Error ? err.message : String(err)
            this.setStatus('error')
            this.dispatchStatus()
            log.error('Long Polling error', this.lastError)
            reject(err)
          })
        }),
        15_000,
        'Bot start (deleteWebhook + polling) timed out',
      )
    } catch (err) {
      this.lastError = unwrapError(err)
      this.setStatus('error')
      log.error('Failed to start Telegram Bot', this.lastError)
      if (err instanceof HttpError) {
        log.debug('grammy HttpError details', err.message, 'underlying error:', err.error)
      }
      this.dispatchStatus()
    }
  }

  /** Lightweight token validation — calls getMe() without starting Long Polling. */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      return { success: false, error: 'Bot Token not configured' }
    }
    try {
      const testBot = new Bot(config.botToken, {
        client: { ...(this.deps.fetch ? { fetch: this.deps.fetch } : {}) },
      })
      await withTimeout(testBot.api.getMe(), 10_000, 'Connection timed out (10s)')
      return { success: true, error: undefined }
    } catch (err) {
      return { success: false, error: unwrapError(err) }
    }
  }

  stop(): void {
    if (this.bot) {
      this.bot.stop()
      this.bot = null
    }
    this.setStatus('disconnected')
    this.connectedAt = null
    this.botUsername = null
    // Clear ephemeral streaming state — any in-flight Telegram placeholder bubbles
    // are left as-is; they'll appear as historical "working…" indicators.
    this.editStrategy?.releaseAll()
    this.draftStrategy?.releaseAll()
    this.editStrategy = null
    this.draftStrategy = null
    this.lastEvoseContent.clear()
    this.lastEvoseCommitContent.clear()
    this.typingTimers.forEach((timer) => clearInterval(timer))
    this.typingTimers.clear()
    this.pendingNewPrompts.clear()
    this.dispatchStatus()
  }

  // --- Internal message handling ---

  private async onCommand(ctx: Context): Promise<void> {
    try {
      const text = ctx.message?.text ?? ''
      const userId = ctx.from?.id ?? 0
      const chatId = String(ctx.message?.chat?.id ?? ctx.chat?.id ?? 0)
      const replyToId = ctx.message?.reply_to_message?.message_id as number | undefined

      if (!text.trim()) return
      this.messagesReceived++

      // Immediately show "typing..." to cover the processing delay before the streaming placeholder appears
      ctx.replyWithChatAction('typing').catch(() => {})

      // ── issue_creation mode intercept ──────────────────────────────────────
      // When the user clicks "New Issue", chatContext.mode is set to 'issue_creation',
      // and the next text message is treated as an Issue description, routed to IssueHandler (not the normal chat flow).
      const botId = this.deps.getConfig().id
      const chatCtx = this.chatContext.get(botId, chatId)
      if (chatCtx.mode === 'issue_creation') {
        await this.issueHandler.handleCreationMessage(ctx, text)
        return
      }
      // ────────────────────────────────────────────────────────────────────

      // ── ForceReply intercept ──────────────────────────────────────────────
      // When chatId is in "awaiting new session prompt" state (user just sent /new),
      // the next message is used as the new session's prompt instead of normal routing.
      //
      // Matching logic (either condition triggers):
      //   1. Exact match: user replied to the ForceReply bot message
      //   2. Fallback match: user's next plain text message (didn't use reply button but continued typing)
      //
      // If the user sends a command (/xxx), the pending state is cancelled and the command
      // is routed normally, preventing commands from being consumed as session prompts.
      const pendingMsgId = this.pendingNewPrompts.get(chatId)
      if (pendingMsgId !== undefined) {
        const isExactReply = replyToId === pendingMsgId
        const isPlainTextFallback = !text.trim().startsWith('/')

        if (isExactReply || isPlainTextFallback) {
          // Consume pending state, start a new session with this text
          this.pendingNewPrompts.delete(chatId)
          const prompt = text.trim()
          if (prompt) {
            await this.deps.orchestrator.startSession({
              prompt,
              origin: this.getTelegramOrigin(chatId),
              workspace: this.resolveStartWorkspace(chatId),
            })
          }
          return // Streaming response is the only feedback
        }

        // User sent a command (/xxx) → cancel pending, process command normally
        this.pendingNewPrompts.delete(chatId)
      }
      // ────────────────────────────────────────────────────────────────────

      const result = await this.handleCommand(text, userId, chatId)
      if (!result) return

      // ForceReply messages need special handling: must get sent.message_id to record pending state
      if ('force_reply' in (result.reply_markup ?? {})) {
        const sent = await ctx.reply(result.text, {
          parse_mode: result.parse_mode,
          reply_markup: result.reply_markup,
        })
        this.pendingNewPrompts.set(chatId, sent.message_id)
        this.messagesSent++
        return
      }

      await ctx.reply(result.text, {
        parse_mode: result.parse_mode,
        reply_markup: result.reply_markup,
      })
      this.messagesSent++
    } catch (err) {
      log.error('Error processing Telegram message', err instanceof Error ? err.message : String(err))
      try { await ctx.reply('\u274C Internal error, please try again later') } catch { /* ignore */ }
    }
  }

  /**
   * Process a command and return a formatted message.
   *
   * Routing:
   *   - `chat` action → handled via shared `routeIMMessage()` (unified session routing)
   *   - All other actions → delegated to shared `executeCommand()`, result translated
   *     by `renderCommandResult()` into Telegram-specific `FormattedMessage`.
   *
   * @param text    - Original Telegram message text
   * @param userId  - Sender's Telegram user ID (for permission checks)
   * @param chatId  - Telegram chat ID where the message was sent (for session routing and creation)
   *
   * Exposed as public for unit testing convenience.
   */
  async handleCommand(text: string, userId: number, chatId: string): Promise<FormattedMessage | null> {
    const config = this.deps.getConfig()

    // Permission check
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      return this.fmt.permissionDeniedMessage()
    }

    const { action, args } = this.router.parse(text)
    const origin = this.getTelegramOrigin(chatId)
    // Workspace binding: per-chat temporary project override takes precedence over
    // the Bot's global defaultWorkspace (set via Bot Settings UI).
    const newSessionDefaults = {
      workspace: this.resolveStartWorkspace(chatId),
    }

    // ── chat action: shared session routing via routeIMMessage ─────────────
    if (action === 'chat') {
      return this.handleChatAction(args, origin, config.id, chatId, newSessionDefaults)
    }

    // ── All other actions → shared command handler ────────────────────────
    const ctx: CommandContext = {
      orchestrator: this.deps.orchestrator,
      platform: 'telegram',
      connectionId: config.id,
      chatId,
      origin,
      newSessionDefaults,
      onSessionEnd: () => this.releaseStreamingState(chatId),
    }

    const result = await executeCommand(action, args, ctx)
    return this.renderCommandResult(result, chatId)
  }

  /**
   * Handle the `chat` action via shared `routeIMMessage()`.
   *
   * Uses the same session-routing decision tree as all other IM platforms:
   *   no session → new | busy → hint | active/idle → send/resume/fallback-new
   *
   * Platform-specific UX (busy hint text) is applied after routing.
   */
  private async handleChatAction(
    args: Record<string, string>,
    origin: SessionOrigin,
    connectionId: string,
    chatId: string,
    newSessionDefaults?: CommandContext['newSessionDefaults'],
  ): Promise<FormattedMessage | null> {
    const prompt = args.prompt?.trim()
    if (!prompt) return null

    const result = await routeIMMessage({
      orchestrator: this.deps.orchestrator,
      content: [{ type: 'text' as const, text: prompt }],
      origin,
      connectionId,
      chatId,
      newSessionDefaults,
    })

    if (result.outcome === 'busy') {
      return this.fmt.textMessage(
        `⏳ Claude is still processing the previous message, please wait...\n\nSend /new to start a new session`,
      )
    }
    if (result.outcome === 'error') {
      const msg = result.error instanceof Error ? result.error.message : String(result.error)
      log.error('Error handling chat action', msg)
      return this.fmt.textMessage(`❌ Execution error: ${msg}`)
    }

    // 'sent' or 'new_session' → streaming response is the feedback
    return null
  }

  /**
   * Translate a semantic `CommandResult` into a Telegram-specific `FormattedMessage`.
   *
   * This is the Presentation Layer for Telegram — it maps purely semantic results
   * from the shared Execution Layer into Telegram-native UX (ForceReply, InlineKeyboard,
   * HTML messages, etc.).
   */
  private renderCommandResult(result: CommandResult, _chatId: string): FormattedMessage | null {
    switch (result.type) {
      case 'noop':
        return null

      case 'prompt_required':
        // Telegram-specific: ForceReply guides user input in a native two-step interaction
        return this.fmt.forceReplyMessage('💬 Enter what you want to discuss with Claude:')

      case 'missing_argument':
        return this.fmt.textMessage(
          `❌ Missing <${result.argument}> for /${result.command}. Example: /reply <sessionId> <message>`,
        )

      // Side effects (releaseStreamingState) are handled by onSessionEnd in CommandContext
      case 'session_cleared':
        return this.fmt.textMessage('🗑️ Current session cleared. Send a message to start a new conversation')

      case 'session_stopped':
        return this.fmt.textMessage(`⏹️ Session ${result.sessionId.slice(0, 8)} stopped`)

      case 'no_active_session':
        return this.fmt.textMessage('✨ No active session. Send a message to start a new conversation')

      case 'session_not_found':
        return this.fmt.textMessage(`❌ Session not found: ${result.query}`)

      case 'session_busy':
        return this.fmt.textMessage(
          `⏳ Claude is still processing, please wait...\n\nSend /new to start a new session`,
        )

      case 'stop_failed':
        return this.fmt.textMessage(`❌ Stop failed`)

      case 'reply_sent':
        return null // Streaming response is the feedback

      case 'reply_failed':
        return this.fmt.textMessage(`❌ Reply failed: session may have ended`)

      case 'session_list':
        return this.fmt.statusMessage(
          result.sessions.map((s) => ({
            id: s.id,
            name: s.id.slice(0, 8),
            state: s.state,
            activity: s.activity,
          })),
        )

      case 'issues':
        // Telegram-specific: interactive filter keyboard from IssueHandler
        return this.issueHandler.buildFilterKeyboard()

      case 'inbox':
        return this.fmt.textMessage('📬 Inbox feature coming soon, stay tuned!')

      case 'menu':
      case 'help':
        return this.fmt.helpMessage()

      case 'error': {
        const msg = result.cause instanceof Error ? result.cause.message : String(result.cause)
        return this.fmt.textMessage(`❌ Execution error: ${msg}`)
      }

      default:
        return this.fmt.helpMessage()
    }
  }

  /**
   * Route downloaded and base64-encoded image content to the corresponding session.
   *
   * Symmetric with handleCommand: only handles permission checks + session routing,
   * no network downloads, making it easy to unit test routing logic independently.
   *
   * @returns 'denied'  — Permission check failed
   *          'busy'    — Current session is busy, cannot accept new messages
   *          'ok'      — Successfully dispatched (startSession / sendMessage / resumeSession)
   */
  async handlePhotoMessage(
    content: UserMessageContent,
    userId: number,
    chatId: string,
  ): Promise<'denied' | 'busy' | 'ok'> {
    const config = this.deps.getConfig()

    // Permission check
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      return 'denied'
    }

    const origin = this.getTelegramOrigin(chatId)
    const workspace = this.resolveStartWorkspace(chatId)

    // ForceReply intercept: chat is awaiting new session prompt → use image (with caption) as prompt
    const pendingMsgId = this.pendingNewPrompts.get(chatId)
    if (pendingMsgId !== undefined) {
      this.pendingNewPrompts.delete(chatId)
      await this.deps.orchestrator.startSession({ prompt: content, origin, workspace })
      return 'ok'
    }

    // Route to current chat's active session, or create a new one if none
    const active = await this.findActiveSession(chatId)

    if (!active) {
      await this.deps.orchestrator.startSession({ prompt: content, origin, workspace })
      return 'ok'
    }

    // Session busy → friendly prompt
    if (active.state === 'streaming' || active.state === 'creating') {
      return 'busy'
    }

    // Continue (awaiting_input or idle)
    let ok = await this.deps.orchestrator.sendMessage(active.id, content)
    if (!ok) ok = await this.deps.orchestrator.resumeSession(active.id, content)

    // Continue failed (session terminated, etc.) → start new session
    if (!ok) {
      await this.deps.orchestrator.startSession({ prompt: content, origin, workspace })
    }
    return 'ok'
  }

  /**
   * Resolve workspace binding for new sessions in this chat.
   *
   * Precedence:
   * 1) Chat-scoped active project ID
   * 2) Bot default workspace
   * 3) Global (~)
   */
  private resolveStartWorkspace(chatId: string): SessionWorkspaceInput {
    const config = this.deps.getConfig()
    const chatCtx = this.chatContext.get(config.id, chatId)

    const activeProjectId = chatCtx.activeProjectId?.trim()
    if (activeProjectId) {
      return { scope: 'project', projectId: activeProjectId }
    }

    return resolveUserWorkspaceBinding(config.defaultWorkspace)
  }

  /**
   * Route voice/audio messages: permission check → reply "not supported" prompt.
   *
   * Claude API does not currently accept audio input, so voice content cannot be
   * passed directly to Claude. This method's main purposes:
   *   1. Prevent silent failure (user gets no response after sending voice)
   *   2. Maintain symmetric architecture with handlePhotoMessage for future speech-to-text integration (e.g. Whisper)
   *
   * TODO: Once Claude API supports audio input, or an external STT service is integrated,
   *       replace this with the full flow: download voice file → transcribe → route to session.
   *
   * @returns 'denied'        — Permission check failed
   *          'not_supported' — Voice messages not yet supported (user notified)
   */
  async handleVoiceMessage(
    userId: number,
    chatId: string,
  ): Promise<'denied' | 'not_supported'> {
    const config = this.deps.getConfig()

    // Permission check
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      return 'denied'
    }

    // Speech-to-text not yet integrated, return not_supported for caller to notify user
    void chatId // reserved for future routing (e.g. start a session once transcription is available)
    return 'not_supported'
  }

  /**
   * Handle Telegram voice / audio messages: permission check → reply with friendly prompt.
   *
   * Telegram voice messages (user holds to record in client) are sent in OGG/Opus format;
   * audio messages (user uploads MP3/M4A files) also go through this handler.
   * Both are triggered via `message:voice` and `message:audio` events.
   */
  private async onVoiceMessage(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id ?? 0
      const chatId = String(ctx.message?.chat?.id ?? ctx.chat?.id ?? 0)

      this.messagesReceived++

      // Immediately show "typing..."
      ctx.replyWithChatAction('typing').catch(() => {})

      const result = await this.handleVoiceMessage(userId, chatId)

      if (result === 'denied') {
        const denied = this.fmt.permissionDeniedMessage()
        try { await ctx.reply(denied.text, { parse_mode: denied.parse_mode }) } catch { /* ignore */ }
      } else {
        // not_supported — tell user to use text instead
        try {
          await ctx.reply(
            '🎤 Voice messages are not supported yet.\n\nPlease send your message as text, and Claude will help you.',
          )
          this.messagesSent++
        } catch { /* ignore */ }
      }
    } catch (err) {
      log.error('Error processing Telegram voice message', err instanceof Error ? err.message : String(err))
      try { await ctx.reply('❌ Error processing voice message, please send a text message') } catch { /* ignore */ }
    }
  }

  /**
   * Handle Telegram photo messages: download image → base64 encode → route to session.
   *
   * Telegram photo message structure:
   *   - message.photo  — PhotoSize[] array (Telegram provides multiple resolutions, last one is largest)
   *   - message.caption — User-provided caption text (optional)
   *
   * Download uses deps.fetch (proxy-aware) instead of global fetch, consistent with grammy.
   */
  private async onPhotoMessage(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id ?? 0
      const chatId = String(ctx.message?.chat?.id ?? ctx.chat?.id ?? 0)
      const caption = (ctx.message?.caption ?? '').trim()
      const photos: Array<{ file_id: string }> = ctx.message?.photo ?? []

      this.messagesReceived++

      // Immediately show "typing..."
      ctx.replyWithChatAction('typing').catch(() => {})

      if (!this.bot) return

      // Get largest image (Telegram array is sorted by size ascending, last one is highest resolution)
      const largestPhoto = photos[photos.length - 1]
      if (!largestPhoto) return

      const config = this.deps.getConfig()

      // Download image
      let base64Data: string
      let sizeBytes: number
      let mediaType: string

      try {
        const file = await this.bot.api.getFile(largestPhoto.file_id)
        const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`
        const fetchFn = this.deps.fetch ?? globalThis.fetch
        const response = await fetchFn(fileUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        base64Data = Buffer.from(buffer).toString('base64')
        sizeBytes = buffer.byteLength

        // Infer MIME type from file extension (Telegram photos are usually JPEG)
        const ext = (file.file_path ?? '').split('.').pop()?.toLowerCase() ?? 'jpg'
        const mediaTypeMap: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
        }
        mediaType = mediaTypeMap[ext] ?? 'image/jpeg'
      } catch (err) {
        log.error('Failed to download Telegram image', err instanceof Error ? err.message : String(err))
        try { await ctx.reply('❌ Unable to download image, please try again later') } catch { /* ignore */ }
        return
      }

      // Build UserMessageContent: caption (optional) + image block
      const content: UserMessageContent = [
        ...(caption ? [{ type: 'text' as const, text: caption }] : []),
        { type: 'image' as const, mediaType, data: base64Data, sizeBytes },
      ]

      // Route
      const result = await this.handlePhotoMessage(content, userId, chatId)

      if (result === 'denied') {
        const denied = this.fmt.permissionDeniedMessage()
        try { await ctx.reply(denied.text, { parse_mode: denied.parse_mode }) } catch { /* ignore */ }
      } else if (result === 'busy') {
        try {
          await ctx.reply('⏳ Claude is still processing the previous message, please wait...\n\nSend /new to start a new session')
        } catch { /* ignore */ }
      }
      // 'ok' → no additional reply needed, streaming response is the feedback
    } catch (err) {
      log.error('Error processing Telegram photo message', err instanceof Error ? err.message : String(err))
      try { await ctx.reply('❌ Error processing image, please try again later') } catch { /* ignore */ }
    }
  }

  /**
   * Find the "current conversation" for a given chat: the most recently active non-terminated session.
   *
   * Filter conditions (all must match):
   *   - origin.source === 'telegram'
   *   - origin.botId  === this.botUsername  (sessions created by this Bot instance)
   *   - origin.chatId === chatId            (sessions created in this chat)
   *   - state is not stopped / error
   *
   * Priority: awaiting_input > streaming/creating > idle
   * Within the same priority, sorted by lastActivity descending (most recent first).
   */
  private async findActiveSession(chatId: string): Promise<SessionSnapshot | null> {
    const config = this.deps.getConfig()
    return findActiveIMSession({
      orchestrator: this.deps.orchestrator,
      platform: 'telegram',
      connectionId: config.id,
      chatId,
    })
  }

  /**
   * Build the SessionOrigin for this Telegram Bot's specific chat.
   *
   * @param chatId - Telegram chat ID where the message was sent (from ctx.message.chat.id)
   *
   * botId uses TelegramBotEntry.id (UUID) as the app-internal stable identifier,
   * decoupled from the Telegram-side botUsername (which can be changed via @BotFather).
   * TelegramBotManager routes messages to the correct Service instance via this UUID.
   */
  private getTelegramOrigin(chatId: string): SessionOrigin {
    return { source: 'telegram', botId: this.deps.getConfig().id, chatId }
  }

  // --- Session lifecycle cleanup ---

  /**
   * Release all streaming state tracked for a chat when its driving session
   * ends (idle, error, or external stop).
   *
   * In the normal happy path the strategy state is already cleaned up by
   * `handleAssistantMessage` when the final text turn finalises.  This method
   * is a safety-net for the cases where the session terminates without a final
   * text turn: user-initiated `/stop`, `/clear`, session error, or a crash.
   *
   * Leaving stale state would prevent a fresh bubble from being created for
   * the NEXT request on the same chat.
   */
  releaseActivePlaceholder(origin: SessionOrigin): void {
    const chatId = origin.source === 'telegram' ? origin.chatId : ''
    if (!chatId) return
    this.releaseStreamingState(chatId)
  }

  /**
   * Unified cleanup for all streaming-related per-chat state.
   * Called by command handlers (/stop, /clear), callback queries, and lifecycle hooks.
   */
  private releaseStreamingState(chatId: string): void {
    this.draftStrategy?.release(chatId)
    this.editStrategy?.release(chatId)
    this.lastEvoseContent.delete(chatId)
    this.lastEvoseCommitContent.delete(chatId)
    this.stopTypingRefresh(chatId)
  }

  /**
   * Commit saved Evose progress as permanent message(s) before overwriting.
   *
   * Called from `handleAssistantMessage(isStreaming=true)` when Claude starts
   * a new streaming turn that would overwrite the Evose progress placeholder.
   *
   * Multi-message support:
   *   When Evose output exceeds 4096 chars, the full commit HTML is split
   *   into multiple Telegram messages at semantic boundaries (</pre>, \n\n, \n).
   *   The first chunk replaces the existing placeholder (Edit strategy) or is
   *   sent first (Draft strategy); remaining chunks are sent as new messages.
   *
   * Strategy-aware:
   *   - Edit strategy: first chunk uses `finalize()` to edit the placeholder
   *     in-place → permanent message. Remaining chunks sent via `sendMessage`.
   *   - Draft strategy: sends ALL chunks as permanent messages FIRST, THEN
   *     releases the draft. This order eliminates the visual gap where
   *     the draft disappears before the permanent message arrives.
   *
   * In both cases, the strategy state is released, so the subsequent
   * streaming `sendUpdate()` creates a fresh placeholder for Claude's text.
   */
  private async commitEvoseProgress(chatId: string): Promise<void> {
    // Prefer the full (untruncated) commit HTML; fall back to streaming placeholder
    const commitHtml = this.lastEvoseCommitContent.get(chatId)
    const fallbackHtml = this.lastEvoseContent.get(chatId)
    const html = commitHtml ?? fallbackHtml
    if (!html) return

    this.lastEvoseContent.delete(chatId)
    this.lastEvoseCommitContent.delete(chatId)

    // Split into Telegram-safe chunks (each ≤ 4096 chars)
    const chunks = this.fmt.splitForTelegram(html)
    if (chunks.length === 0) return

    // Find which strategy owns the active placeholder
    const activeStrategy = this.draftStrategy?.hasActive(chatId) ? this.draftStrategy
      : this.editStrategy?.hasActive(chatId) ? this.editStrategy
      : null

    if (!activeStrategy) {
      // No active placeholder (rare edge case) → send all chunks as new messages
      for (const chunk of chunks) {
        await this.sendHtmlToChat(chatId, chunk, { silent: true })
      }
      return
    }

    if (activeStrategy === this.editStrategy) {
      // Edit strategy: first chunk edits the placeholder in-place → permanent.
      // No visual gap — the message is updated atomically.
      const committed = await activeStrategy.finalize({ chatId, htmlChunks: [chunks[0]] })
      if (!committed) {
        await this.sendHtmlToChat(chatId, chunks[0], { silent: true })
      }
      // Remaining chunks sent as new messages
      for (let i = 1; i < chunks.length; i++) {
        await this.sendHtmlToChat(chatId, chunks[i], { silent: true })
      }
    } else {
      // Draft strategy: send ALL chunks as permanent messages FIRST, then release.
      //
      // Order matters! The draft is an ephemeral bubble that disappears when
      // keepAlive stops. If we finalize (= stop keepAlive + delete state) first
      // and then send the permanent message, there's a visible gap where:
      //   1. Draft disappears (keepAlive stopped)
      //   2. Network roundtrip (200ms–2000ms+)
      //   3. Permanent message appears
      //
      // By sending first, the permanent message is already visible when the
      // draft disappears — seamless transition.
      for (const chunk of chunks) {
        await this.sendHtmlToChat(chatId, chunk, { silent: true })
      }
      activeStrategy.release(chatId) // stops keepAlive, deletes state
    }
  }

  /**
   * Start a repeating `sendChatAction('typing')` refresh for a chat.
   *
   * Fires once immediately, then every 4 s (safely below Telegram's 5 s expiry).
   * The interval is cancelled automatically when:
   *   - `stopTypingRefresh(chatId)` is called (next streaming turn begins)
   *   - `releaseActivePlaceholder(origin)` is called (session ends / error)
   *   - `stop()` is called (bot shutdown)
   */
  private startTypingRefresh(chatId: string): void {
    this.stopTypingRefresh(chatId) // cancel any existing timer for this chat
    if (!this.bot) return

    // Fire immediately so there's no visible gap
    this.bot.api.sendChatAction(chatId, 'typing').catch(() => {})

    const timer = setInterval(() => {
      if (!this.bot) {
        this.stopTypingRefresh(chatId)
        return
      }
      this.bot.api.sendChatAction(chatId, 'typing').catch(() => {
        // Likely a network error or the chat was deleted — stop retrying
        this.stopTypingRefresh(chatId)
      })
    }, 4_000)

    this.typingTimers.set(chatId, timer)
  }

  private stopTypingRefresh(chatId: string): void {
    const timer = this.typingTimers.get(chatId)
    if (timer !== undefined) {
      clearInterval(timer)
      this.typingTimers.delete(chatId)
    }
  }

  /**
   * Send a "round complete" footer to the Telegram chat that originated the session.
   * Called by main.ts on `command:session:idle` for all Telegram-originated sessions.
   */
  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    const chatId = origin.source === 'telegram' ? origin.chatId : ''
    if (!this.bot || !chatId) return
    const msg = this.fmt.sessionDoneMessage(stopReason)
    await this.sendToChat(chatId, msg)
  }

  /**
   * Handle a single assistant message event — covers both streaming updates and
   * finalized messages.
   *
   * Routing: replies go to `origin.chatId` (the chat that initiated the session).
   * This ensures each user gets their own response in their own chat,
   * regardless of bot configuration.
   *
   * Streaming lifecycle (one active bubble per chatId across ALL SDK turns):
   *   1. First event with content  → sendMessage (plain-text placeholder)
   *   2. Subsequent streaming events → throttled editMessageText (in-place update)
   *   3. SDK turn ends with text/tools → editMessageText (final HTML) + sendChatAction('typing')
   *      ToolUseBlocks are rendered as compact summaries (💻 Bash: `cmd`)
   *   4. SDK turn ends, content-less → bubble kept visible (rare: thinking-only turns)
   *
   * Because the placeholder is keyed by chatId — not by SDK message ID — the
   * same Telegram bubble is reused across all of Claude's internal turns
   * (tool-call → more text → more tools → final answer). This eliminates
   * orphaned intermediate bubbles without any stale-cleanup bookkeeping.
   *
   * Non-streaming messages (isStreaming=false with no prior placeholder) are sent
   * directly as rich HTML.
   *
   * @param sessionOrigin - The SessionOrigin of the session that produced this message.
   *                        Must have source='telegram' with a valid chatId.
   * @param sessionId     - Used to generate the ⏹️ stop button callback_data for the
   *                        streaming bubble so the user can abort mid-execution.
   */
  async handleAssistantMessage(
    sessionOrigin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    if (message.role !== 'assistant') return
    if (!this.bot) return
    if (sessionOrigin.source !== 'telegram') return
    if (!this.editStrategy) return // not started — editStrategy is the universal fallback

    const chatId = sessionOrigin.chatId
    if (!chatId) return

    if (message.isStreaming) {
      // ── Streaming in progress ────────────────────────────────────────────
      const rawText = message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')

      const toolActivity = this.fmt.extractToolActivity(message.content)

      // Nothing to display yet — skip silently.
      if (!rawText.trim() && !toolActivity) return

      // Streaming has begun — cancel the between-turns typing refresh (if active).
      this.stopTypingRefresh(chatId)

      // ── Evose → Claude transition ────────────────────────────────────────
      // If the previous placeholder was showing Evose progress, "commit" it
      // as a permanent message before Claude's text overwrites it.
      // This preserves the agent summary (tool calls + text) for the user.
      await this.commitEvoseProgress(chatId)

      const content = this.fmt.streamingPlaceholder(rawText, toolActivity)

      // Strategy selection with automatic degradation:
      // 1. Select preferred strategy (draft for private chats, edit for groups)
      // 2. If the preferred strategy fails (returns false), fall back to edit
      let strategy = this.selectStrategy(chatId)
      const ok = await strategy.sendUpdate({ chatId, content, sessionId })
      if (!ok && strategy !== this.editStrategy) {
        strategy = this.editStrategy!
        await strategy.sendUpdate({ chatId, content, sessionId })
      }
      return
    }

    // ── SDK turn finalized ────────────────────────────────────────────────

    // If the previous placeholder was showing Evose progress, commit it as
    // a permanent message before the finalize overwrites the bubble.
    // Same protection as the streaming branch above — handles the case where
    // the SDK turn finalizes (isStreaming=false) instead of streaming first.
    await this.commitEvoseProgress(chatId)

    const htmlChunks = this.fmt.formatAssistantBlocks(message.content)

    if (htmlChunks.length === 0) {
      // Truly content-less turn (e.g. thinking-only or image-only blocks).
      // Keep any active placeholder visible as a visual indicator.
      return
    }

    // Determine which strategy owns the active bubble for this chat.
    // Draft and Edit are mutually exclusive per chat — at most one has state.
    const activeStrategy = this.draftStrategy?.hasActive(chatId) ? this.draftStrategy
      : this.editStrategy?.hasActive(chatId) ? this.editStrategy
      : null

    // Delegate finalization to the strategy. If it returns true, the first
    // chunk was edited in-place (replacing the placeholder); otherwise we
    // must send all chunks as new messages.
    const firstReplaced = activeStrategy
      ? await activeStrategy.finalize({ chatId, htmlChunks })
      : false

    if (!firstReplaced && htmlChunks.length > 0) {
      // Strategy couldn't replace → send first chunk as new message
      await this.sendHtmlToChat(chatId, htmlChunks[0])
    }

    // Remaining chunks (or all chunks if strategy had no active bubble).
    // Only the final chunk triggers a push notification; earlier chunks are silenced
    // to avoid repeated vibration alerts when a long response spans multiple messages.
    const remaining = htmlChunks.slice(1)
    for (let i = 0; i < remaining.length; i++) {
      const isFinal = i === remaining.length - 1
      await this.sendHtmlToChat(chatId, remaining[i], { silent: !isFinal })
    }

    // If this turn contained tool calls, Claude is about to execute them.
    // Start a repeating typing refresh so the indicator stays visible for the
    // entire execution gap (5–60 s). It will be cancelled automatically when
    // the next streaming turn begins or the session ends.
    const hadToolUse = message.content.some((b) => b.type === 'tool_use')
    if (hadToolUse) {
      this.startTypingRefresh(chatId)
    }
  }

  /**
   * Select the preferred streaming strategy for a chat.
   *
   * Priority:
   *   1. If a strategy already has an active bubble for this chat → continue with it
   *      (avoids mid-stream switching that would cause duplicate messages)
   *   2. Private chat (positive integer chatId) → draft strategy
   *      (native typing animation, no "edited" tag, 300ms throttle)
   *   3. Group/supergroup/channel (negative chatId) → edit strategy
   *      (draft only supports private chats)
   *
   * The caller handles degradation: if the selected strategy's sendUpdate()
   * returns false, it falls back to editStrategy.
   */
  private selectStrategy(chatId: string): StreamingStrategy {
    // Already active → continue (never switch mid-stream)
    if (this.draftStrategy?.hasActive(chatId)) return this.draftStrategy
    if (this.editStrategy?.hasActive(chatId)) return this.editStrategy!

    // Private chat → prefer draft (positive integer chatId)
    if (this.draftStrategy) {
      const numId = Number(chatId)
      if (Number.isFinite(numId) && numId > 0) return this.draftStrategy
    }

    // Groups / channels / fallback
    return this.editStrategy!
  }

  /**
   * Handle an Evose relay progress update — shows Agent sub-tool activity
   * in a single placeholder bubble (created or updated in place).
   *
   * This method is called for `command:session:message` events marked with
   * `isRelayProgress: true`.  Unlike `handleAssistantMessage` (which renders
   * full message snapshots), this only extracts the Evose tool activity
   * from `progressBlocks[]` and displays a compact status list.
   *
   * Placeholder lifecycle aligns with the normal streaming flow:
   *   1. First activity → sendMessage (creates placeholder, same map key as streaming)
   *   2. Subsequent     → editMessageText (in-place update, 1 s throttle)
   *   3. Agent finishes → next SDK turn streams → streaming handler reuses the bubble
   *
   * Because the placeholder is keyed by chatId (shared with the streaming handler),
   * the transition from "Evose progress" to "Claude streaming" is seamless.
   */
  async handleEvoseProgress(
    sessionOrigin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    if (message.role !== 'assistant') return
    if (!this.bot) return
    if (sessionOrigin.source !== 'telegram') return
    if (!this.editStrategy) return // not started

    const chatId = sessionOrigin.chatId
    if (!chatId) return

    // [DIAG] Log what we receive for debugging
    const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use')
    const progressSummary = toolUseBlocks.map((b) =>
      b.type === 'tool_use'
        ? `${b.name}[progressBlocks=${b.progressBlocks?.length ?? 0}]`
        : '',
    )
    log.info(`[DIAG] handleEvoseProgress: chatId="${chatId}", toolUseBlocks=${toolUseBlocks.length}, progress=[${progressSummary.join(', ')}]`)

    // Extract Evose sub-tool activity from progressBlocks[]
    const activity = this.fmt.extractEvoseActivity(message.content)
    if (!activity) {
      log.info(`[DIAG] handleEvoseProgress: extractEvoseActivity returned null — no tool_call blocks yet`)
      return
    }
    log.info(`[DIAG] handleEvoseProgress: activity found — agent="${activity.agentName}", toolCalls=${activity.toolCalls.length}`)

    // Cancel typing refresh — we're now showing real activity in the placeholder
    this.stopTypingRefresh(chatId)

    const content = this.fmt.evoseActivityPlaceholder(activity)

    // Save for later commit — when Claude's next streaming turn is about to
    // overwrite this placeholder, commitEvoseProgress() will preserve this
    // content as a permanent message first.
    this.lastEvoseContent.set(chatId, content)

    // Save the full (untruncated) commit HTML — used by commitEvoseProgress()
    // to generate the permanent message(s). Unlike the streaming placeholder,
    // this preserves the complete Evose output with Markdown→HTML conversion,
    // and may exceed 4096 chars (split into multiple messages at commit time).
    const commitHtml = this.fmt.evoseCommitHtml(activity)
    this.lastEvoseCommitContent.set(chatId, commitHtml)

    // Strategy selection with degradation — same logic as handleAssistantMessage
    let strategy = this.selectStrategy(chatId)
    const ok = await strategy.sendUpdate({ chatId, content, sessionId })
    if (!ok && strategy !== this.editStrategy) {
      strategy = this.editStrategy!
      await strategy.sendUpdate({ chatId, content, sessionId })
    }
  }

  // --- Internal helpers ---

  // resolveSessionId() moved to shared layer: messaging/commandHandler.ts

  /**
   * Send a richly-formatted HTML assistant message.
   * Falls back to plain text if Telegram rejects the HTML parse (e.g. unclosed tags).
   *
   * @param opts.silent - When true, disables push notification (use for non-final chunks
   *                      in multi-message responses to avoid repeated vibration alerts).
   */
  private async sendHtmlToChat(chatId: string, rawHtml: string, opts: { silent?: boolean } = {}): Promise<void> {
    if (!this.bot) return

    // Safety: Telegram enforces 4096-char limit on message text.
    // Truncate gracefully rather than letting the API reject the call.
    const LIMIT = 4096
    const html = rawHtml.length > LIMIT
      ? rawHtml.slice(0, snapToGraphemeBoundary(rawHtml, LIMIT - 1)) + '…'
      : rawHtml

    try {
      await this.bot.api.sendMessage(chatId, html, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        disable_notification: opts.silent ?? false,
      })
      this.messagesSent++
    } catch (err) {
      // Telegram rejected the HTML — strip tags and send as plain text
      log.warn('HTML message send failed, falling back to plain text', unwrapError(err))
      let plain = rawHtml.replace(/<[^>]+>/g, '').trim()
      if (!plain) return
      if (plain.length > LIMIT) plain = plain.slice(0, snapToGraphemeBoundary(plain, LIMIT - 1)) + '…'
      try {
        await this.bot.api.sendMessage(chatId, plain, {
          disable_notification: opts.silent ?? false,
        })
        this.messagesSent++
      } catch (err2) {
        log.error('Message send ultimately failed', unwrapError(err2))
      }
    }
  }

  /** Send a status/notification FormattedMessage (MarkdownV2 or HTML) */
  private async sendToChat(chatId: string, msg: FormattedMessage): Promise<void> {
    if (!this.bot) return
    try {
      await this.bot.api.sendMessage(chatId, msg.text, {
        parse_mode: msg.parse_mode,
        reply_markup: msg.reply_markup,
        link_preview_options: { is_disabled: true },
      })
      this.messagesSent++
    } catch (err) {
      log.error('Failed to send Telegram message', err instanceof Error ? err.message : String(err))
    }
  }

  private setStatus(status: IMConnectionStatusType): void {
    this.connectionStatus = status
  }

  private dispatchStatus(): void {
    const s = this.getStatus()
    this.deps.dispatch({
      type: 'messaging:status',
      payload: {
        connectionId: s.botId,
        platform: 'telegram',
        connectionStatus: s.connectionStatus,
        connectedAt: s.connectedAt,
        lastError: s.lastError,
        metadata: {
          botUsername: s.botUsername ?? undefined,
          messagesReceived: s.messagesReceived,
          messagesSent: s.messagesSent,
        },
      },
    })
  }
}
