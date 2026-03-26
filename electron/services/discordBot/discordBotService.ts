// SPDX-License-Identifier: Apache-2.0

/**
 * DiscordBotService — handles messaging for a single Discord bot instance.
 *
 * Architecture mirrors FeishuBotService:
 *   1. discord.js Client connection with Gateway Intents
 *   2. Event-driven message reception (messageCreate)
 *   3. Streaming via message.edit() with 1200ms throttle (5 edits/5s limit)
 *   4. Command routing (/new, /clear, /stop, /status, /help)
 *   5. Permission checking (allowedUserIds)
 *   6. Session orchestration integration
 *
 * Key differences from Feishu:
 *   - Uses discord.js Client (not Lark SDK)
 *   - Messages are native Discord Markdown (not Interactive Card JSON)
 *   - 2,000 char limit per message (not 30K)
 *   - message.edit() instead of PATCH /im/v1/messages
 *
 * Proxy support:
 *   - REST API:  undici Dispatcher passed via `rest: { agent }` (native discord.js)
 *   - Gateway WS: ws.WebSocket patched to inject Node.js http.Agent before
 *                 discord.js is first loaded (dynamic import)
 */

// ── Type-only imports (erased at compile time — no runtime require) ──────────
import type { Client as ClientType, Message, TextChannel } from 'discord.js'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  SessionSnapshot,
  IMConnectionStatusType,
  DataBusEvent,
} from '../../../src/shared/types'
import type { DiscordBotServiceDeps, DiscordBotStatus } from './types'
import {
  buildStreamingMessage,
  extractTextFromBlocks,
  extractEvoseActivity,
  buildStatusMessage,
  buildHelpMessage,
  splitForDiscord,
} from './discordMessageFormatter'
import { getIMChatId } from '../messaging/types'
import { findActiveIMSession, routeIMMessage } from '../messaging/sessionRouter'
import { executeCommand, type CommandResult, type CommandContext } from '../messaging/commandHandler'
import { CommandRouter } from '../messaging/commandRouter'
import { createLogger } from '../../platform/logger'
import {
  patchWsForProxy,
  setWsProxyCreateConnection,
  createWsProxyConnection,
  createRestProxyDispatcher,
} from './discordProxyHelper'

const log = createLogger('DiscordBot')

/** Minimum interval between message edits (Discord rate: 5 edits / 5s per message). */
const EDIT_THROTTLE_MS = 1200

/** Minimum characters before sending first streaming message. */
const MIN_FIRST_SEND_LENGTH = 30

// ── Lazy-loaded discord.js runtime values ────────────────────────────────────
//
// discord.js is loaded via dynamic `import()` so that we can patch ws.WebSocket
// BEFORE @discordjs/ws captures it.  Type-only imports above are erased by
// TypeScript — no `require("discord.js")` is emitted.

let _discordLoaded = false
let Client: typeof ClientType
let Events: typeof import('discord.js').Events
let GatewayIntentBits: typeof import('discord.js').GatewayIntentBits
let Partials: typeof import('discord.js').Partials

/**
 * Ensure discord.js runtime values are loaded.
 * On the very first call, patches ws.WebSocket for proxy support, then
 * dynamically imports discord.js (which triggers @discordjs/ws to capture
 * the patched WebSocket constructor).
 */
async function ensureDiscordLoaded(): Promise<void> {
  if (_discordLoaded) return

  // Patch ws BEFORE discord.js is loaded — @discordjs/ws captures ws.WebSocket
  // at module evaluation time.  The `ws` module is already in require cache
  // (hoisted require in the Electron main bundle), so this just replaces the
  // exported WebSocket class with a thin proxy-aware subclass.
  patchWsForProxy()

  const mod = await import('discord.js')
  Client = mod.Client
  Events = mod.Events
  GatewayIntentBits = mod.GatewayIntentBits
  Partials = mod.Partials
  _discordLoaded = true
}

export class DiscordBotService {
  private client: InstanceType<typeof ClientType> | null = null
  private connectionStatus: IMConnectionStatusType = 'disconnected'
  private connectedAt: number | null = null
  private lastError: string | null = null
  private botUsername: string | null = null
  private messagesReceived = 0
  private messagesSent = 0

  // Streaming state per channel
  private activePlaceholders = new Map<string, {
    message: Message
    lastEditAt: number
    pendingContent: string | null
    pendingTimer: ReturnType<typeof setTimeout> | null
    inflight: boolean
    sessionId: string
  }>()
  private lastEvoseContent = new Map<string, string>()
  private readonly router = new CommandRouter()

  constructor(private readonly deps: DiscordBotServiceDeps) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      this.lastError = 'Bot token not configured'
      this.dispatchStatus()
      return
    }

    this.setStatus('connecting')
    this.dispatchStatus()

    try {
      // Ensure discord.js is loaded (patches ws on first call)
      await ensureDiscordLoaded()

      // Configure proxy for REST (undici Dispatcher) and WebSocket (createConnection)
      const proxyUrl = this.deps.getProxyUrl?.() ?? null
      const restAgent = proxyUrl ? createRestProxyDispatcher(proxyUrl) : undefined
      if (proxyUrl) {
        setWsProxyCreateConnection(createWsProxyConnection(proxyUrl))
        log.info(`Proxy configured for Discord bot: ${proxyUrl}`)
      } else {
        setWsProxyCreateConnection(undefined)
      }

      // Create discord.js Client with required intents + proxy
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [
          Partials.Channel, // Required for DM support
          Partials.Message,
        ],
        // Inject undici Dispatcher for REST API calls (native discord.js support)
        ...(restAgent ? { rest: { agent: restAgent } } : {}),
      } as import('discord.js').ClientOptions)

      // Register ready handler
      this.client.once(Events.ClientReady, (readyClient) => {
        this.botUsername = readyClient.user.tag
        this.setStatus('connected')
        this.connectedAt = Date.now()
        this.lastError = null
        this.dispatchStatus()
        log.info(`Discord bot ready: ${readyClient.user.tag} (${config.name})`)
      })

      // Register error handler
      this.client.on(Events.Error, (error) => {
        this.lastError = error.message
        this.setStatus('error')
        this.dispatchStatus()
        log.error('Discord client error', error.message)
      })

      // Register message handler
      this.client.on(Events.MessageCreate, async (message) => {
        try {
          await this.onMessage(message)
        } catch (err) {
          log.error('Message handler error', err instanceof Error ? err.message : String(err))
        }
      })

      // Login with bot token
      await this.client.login(config.botToken)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.lastError = msg
      this.setStatus('error')
      log.error(`Discord bot start failed: ${msg}`)
      this.dispatchStatus()
    }
  }

  stop(): void {
    this.client?.destroy()
    this.client = null
    this.activePlaceholders.clear()
    this.lastEvoseContent.clear()
    this.setStatus('disconnected')
    this.connectedAt = null
    this.dispatchStatus()
    log.info(`Discord bot stopped: ${this.deps.getConfig().name}`)
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      return { success: false, error: 'Bot token not configured' }
    }

    try {
      // Ensure discord.js is loaded (patches ws on first call)
      await ensureDiscordLoaded()

      // Configure proxy for REST and WebSocket
      const proxyUrl = this.deps.getProxyUrl?.() ?? null
      const restAgent = proxyUrl ? createRestProxyDispatcher(proxyUrl) : undefined
      if (proxyUrl) {
        setWsProxyCreateConnection(createWsProxyConnection(proxyUrl))
      }

      const testClient = new Client({
        intents: [GatewayIntentBits.Guilds],
        ...(restAgent ? { rest: { agent: restAgent } } : {}),
      } as import('discord.js').ClientOptions)

      await testClient.login(config.botToken)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timed out'))
        }, 10_000)

        testClient.once(Events.ClientReady, () => {
          clearTimeout(timeout)
          resolve()
        })
        testClient.once(Events.Error, (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })

      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(): DiscordBotStatus {
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

  // ── Message reception ─────────────────────────────────────────────────────

  private async onMessage(message: Message): Promise<void> {
    const config = this.deps.getConfig()

    // Skip bot messages
    if (message.author.bot) return

    // Guild filter: if guildId is configured, only accept messages from that guild
    if (config.guildId && message.guildId && message.guildId !== config.guildId) return

    // Permission check
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(message.author.id)) {
      log.debug(`Permission denied for user ${message.author.id}`)
      return
    }

    this.messagesReceived++

    const text = message.content.trim()
    if (!text) return

    // Strip bot mention prefix if present
    const botId = this.client?.user?.id
    const cleanText = botId
      ? text.replace(new RegExp(`<@!?${botId}>\\s*`), '').trim()
      : text

    if (!cleanText) return

    const channelId = message.channelId
    const guildId = message.guildId ?? undefined

    // Unified command routing via CommandRouter
    const { action, args } = this.router.parse(cleanText)

    if (action === 'chat') {
      await this.handleChat(args.prompt || '', channelId, guildId)
      return
    }

    // All other actions → shared command handler
    const ctx: CommandContext = {
      orchestrator: this.deps.orchestrator,
      platform: 'discord',
      connectionId: config.id,
      chatId: channelId,
      origin: this.getDiscordOrigin(channelId, guildId),
      newSessionDefaults: {
        projectPath: config.defaultWorkspacePath,
        projectId: config.defaultProjectId,
      },
      onSessionEnd: () => this.releaseStreamingState(channelId),
    }

    const result = await executeCommand(action, args, ctx)
    await this.renderCommandResult(result, channelId)
  }

  /**
   * Translate a semantic `CommandResult` into Discord-specific UX.
   *
   * Discord Presentation Layer: maps semantic results to Discord Markdown
   * text messages. Future: could use Embeds for richer presentation.
   */
  private async renderCommandResult(result: CommandResult, channelId: string): Promise<void> {
    switch (result.type) {
      case 'noop':
        return

      case 'prompt_required':
        await this.sendTextToChannel(channelId, 'Please provide a prompt. Example: `/new write a sorting algorithm`')
        return

      case 'missing_argument':
        await this.sendTextToChannel(channelId, `Missing <${result.argument}> for /${result.command}. Usage: /reply <sessionId> <message>`)
        return

      case 'session_cleared':
        await this.sendTextToChannel(channelId, 'Current session cleared.')
        return

      case 'session_stopped':
        await this.sendTextToChannel(channelId, `Session ${result.sessionId.slice(0, 8)} stopped.`)
        return

      case 'no_active_session':
        await this.sendTextToChannel(channelId, 'No active session.')
        return

      case 'session_not_found':
        await this.sendTextToChannel(channelId, `Session not found: ${result.query}`)
        return

      case 'session_busy':
        await this.sendTextToChannel(channelId, 'Processing... please wait.')
        return

      case 'stop_failed':
        await this.sendTextToChannel(channelId, 'Stop failed.')
        return

      case 'reply_sent':
        return // Streaming response is the feedback

      case 'reply_failed':
        await this.sendTextToChannel(channelId, `Reply failed: session may have ended.`)
        return

      case 'session_list': {
        const text = buildStatusMessage(
          result.sessions.map((s) => ({ id: s.id, name: s.id.slice(0, 8), state: s.state })),
        )
        await this.sendTextToChannel(channelId, text)
        return
      }

      case 'issues':
        await this.sendTextToChannel(channelId, '📋 Issues feature coming soon.')
        return

      case 'inbox':
        await this.sendTextToChannel(channelId, '📬 Inbox feature coming soon.')
        return

      case 'menu':
        await this.sendTextToChannel(channelId, buildHelpMessage())
        return

      case 'help':
        await this.sendTextToChannel(channelId, buildHelpMessage())
        return

      case 'error': {
        const msg = result.cause instanceof Error ? result.cause.message : String(result.cause)
        await this.sendTextToChannel(channelId, `Error: ${msg}`)
        return
      }

      default:
        await this.sendTextToChannel(channelId, buildHelpMessage())
        return
    }
  }

  private async handleChat(text: string, channelId: string, guildId?: string): Promise<void> {
    const config = this.deps.getConfig()
    const result = await routeIMMessage({
      orchestrator: this.deps.orchestrator,
      content: [{ type: 'text' as const, text }],
      origin: this.getDiscordOrigin(channelId, guildId),
      connectionId: config.id,
      chatId: channelId,
      newSessionDefaults: {
        projectPath: config.defaultWorkspacePath,
        projectId: config.defaultProjectId,
      },
    })

    if (result.outcome === 'busy') {
      await this.sendTextToChannel(channelId, 'Processing... please wait.')
    } else if (result.outcome === 'error') {
      await this.sendTextToChannel(channelId, 'Failed to start session. Please try again later.')
    }
  }

  // ── Assistant message handling (streaming) ────────────────────────────────

  async handleAssistantMessage(
    _origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const channelId = this.extractChannelId(_origin)
    if (!channelId || !this.client) return

    if (!('content' in message) || message.role !== 'assistant') return
    const blocks = message.content
    const textContent = extractTextFromBlocks(blocks)

    if (message.isStreaming) {
      if (!textContent || textContent.length < MIN_FIRST_SEND_LENGTH) return

      // Commit any Evose progress before starting Claude stream
      await this.commitEvoseProgress(channelId)

      const discordText = buildStreamingMessage({
        content: textContent,
        isStreaming: true,
      })

      await this.sendOrEditMessage(channelId, discordText, sessionId)
    } else {
      // Final message
      await this.commitEvoseProgress(channelId)

      if (!textContent) return

      const chunks = splitForDiscord(textContent)
      const state = this.activePlaceholders.get(channelId)

      if (state && chunks.length > 0) {
        // Edit first chunk into existing placeholder
        try {
          await state.message.edit(chunks[0])
        } catch (err) {
          log.warn('Failed to edit final message', err instanceof Error ? err.message : String(err))
        }
        this.activePlaceholders.delete(channelId)

        // Send remaining chunks as new messages
        for (let i = 1; i < chunks.length; i++) {
          await this.sendTextToChannel(channelId, chunks[i])
        }
      } else {
        // No placeholder — send all as new messages
        this.activePlaceholders.delete(channelId)
        for (const chunk of chunks) {
          await this.sendTextToChannel(channelId, chunk)
        }
      }
    }
  }

  async handleEvoseProgress(
    _origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const channelId = this.extractChannelId(_origin)
    if (!channelId || !this.client) return

    if (!('content' in message)) return
    const blocks = message.content
    const activity = extractEvoseActivity(blocks)
    if (!activity) return

    this.lastEvoseContent.set(channelId, activity)

    const discordText = buildStreamingMessage({
      content: activity,
      isStreaming: true,
    })

    await this.sendOrEditMessage(channelId, discordText, sessionId)
  }

  releaseActivePlaceholder(origin: SessionOrigin): void {
    const channelId = this.extractChannelId(origin)
    if (channelId) {
      this.releaseStreamingState(channelId)
    }
  }

  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    const channelId = this.extractChannelId(origin)
    if (!channelId) return

    this.releaseStreamingState(channelId)

    if (stopReason) {
      await this.sendTextToChannel(channelId, `Session completed${stopReason ? `: ${stopReason}` : ''}`)
    }
  }

  // ── Streaming helpers ─────────────────────────────────────────────────────

  private async sendOrEditMessage(channelId: string, text: string, sessionId: string): Promise<void> {
    const state = this.activePlaceholders.get(channelId)

    if (!state) {
      // First message — create placeholder
      const sentMsg = await this.sendTextToChannel(channelId, text)
      if (sentMsg) {
        this.activePlaceholders.set(channelId, {
          message: sentMsg,
          lastEditAt: Date.now(),
          pendingContent: null,
          pendingTimer: null,
          inflight: false,
          sessionId,
        })
      }
      return
    }

    // Throttle edits
    const now = Date.now()
    if (now - state.lastEditAt < EDIT_THROTTLE_MS) {
      state.pendingContent = text
      if (!state.inflight && !state.pendingTimer) {
        // Schedule flush after throttle window
        state.pendingTimer = setTimeout(() => {
          state.pendingTimer = null
          this.flushPending(channelId)
        }, EDIT_THROTTLE_MS)
      }
      return
    }

    // Direct edit
    state.inflight = true
    state.lastEditAt = now
    try {
      await state.message.edit(text)
    } catch (err) {
      log.warn('Message edit failed', err instanceof Error ? err.message : String(err))
    } finally {
      state.inflight = false
      // Flush any pending content accumulated during in-flight edit
      if (state.pendingContent) {
        const pending = state.pendingContent
        state.pendingContent = null
        await this.sendOrEditMessage(channelId, pending, sessionId)
      }
    }
  }

  private async flushPending(channelId: string): Promise<void> {
    const state = this.activePlaceholders.get(channelId)
    if (!state?.pendingContent || state.inflight) return

    const content = state.pendingContent
    state.pendingContent = null
    await this.sendOrEditMessage(channelId, content, state.sessionId)
  }

  private async commitEvoseProgress(channelId: string): Promise<void> {
    const content = this.lastEvoseContent.get(channelId)
    if (!content) return

    this.lastEvoseContent.delete(channelId)
    const state = this.activePlaceholders.get(channelId)

    if (state) {
      // Finalize the Evose placeholder
      try {
        await state.message.edit(content)
      } catch (err) {
        log.warn('commitEvoseProgress edit failed', err instanceof Error ? err.message : String(err))
      }
      this.activePlaceholders.delete(channelId)
    }
  }

  private releaseStreamingState(channelId: string): void {
    const state = this.activePlaceholders.get(channelId)
    if (state?.pendingTimer) {
      clearTimeout(state.pendingTimer)
    }
    this.activePlaceholders.delete(channelId)
    this.lastEvoseContent.delete(channelId)
  }

  // ── API wrappers ──────────────────────────────────────────────────────────

  private async sendTextToChannel(channelId: string, text: string): Promise<Message | null> {
    if (!this.client) return null

    try {
      const channel = await this.client.channels.fetch(channelId)
      if (!channel || !('send' in channel)) {
        log.warn(`Channel ${channelId} not found or not a text channel`)
        return null
      }

      const sentMessage = await (channel as TextChannel).send(text)
      this.messagesSent++
      return sentMessage
    } catch (err) {
      log.error('sendTextToChannel failed', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  // ── Session helpers ───────────────────────────────────────────────────────

  private async findActiveSession(channelId: string): Promise<SessionSnapshot | null> {
    const config = this.deps.getConfig()
    return findActiveIMSession({
      orchestrator: this.deps.orchestrator,
      platform: 'discord',
      connectionId: config.id,
      chatId: channelId,
    })
  }

  private getDiscordOrigin(channelId: string, guildId?: string): SessionOrigin {
    return {
      source: 'discord',
      botId: this.deps.getConfig().id,
      channelId,
      guildId,
    }
  }

  private extractChannelId(origin: SessionOrigin): string | null {
    return getIMChatId(origin)
  }

  // ── Status helpers ────────────────────────────────────────────────────────

  private setStatus(status: IMConnectionStatusType): void {
    this.connectionStatus = status
  }

  private dispatchStatus(): void {
    const config = this.deps.getConfig()
    this.deps.dispatch({
      type: 'messaging:status',
      payload: {
        connectionId: config.id,
        platform: 'discord',
        connectionStatus: this.connectionStatus,
        connectedAt: this.connectedAt,
        lastError: this.lastError,
        metadata: {
          botUsername: this.botUsername ?? undefined,
          messagesReceived: this.messagesReceived,
          messagesSent: this.messagesSent,
        },
      },
    })
  }
}
