// SPDX-License-Identifier: Apache-2.0

/**
 * FeishuBotService — handles messaging for a single Feishu/Lark bot instance.
 *
 * Architecture mirrors TelegramBotService:
 *   1. SDK-based connection (WSClient for long connection)
 *   2. Event-driven message reception (im.message.receive_v1)
 *   3. Streaming via Interactive Card editing (PATCH /im/v1/messages)
 *   4. Command routing (/new, /clear, /stop, /status, /help)
 *   5. Permission checking (allowedUserIds)
 *   6. Session orchestration integration
 */

import * as lark from '@larksuiteoapi/node-sdk'
import type {
  SessionOrigin,
  ManagedSessionMessage,
  SessionSnapshot,
  IMConnectionStatusType,
} from '../../../src/shared/types'
import type { FeishuBotServiceDeps, FeishuBotStatus } from './types'
import {
  buildStreamingCard,
  buildFinalCard,
  buildTextMessage,
  buildMenuCard,
  buildHelpCard,
  buildStatusCard,
  extractTextFromBlocks,
  extractEvoseActivity,
  splitForFeishu,
} from './feishuMessageFormatter'
import { getIMChatId } from '../messaging/types'
import { findActiveIMSession, routeIMMessage } from '../messaging/sessionRouter'
import { executeCommand, type CommandResult, type CommandContext } from '../messaging/commandHandler'
import { resolveUserWorkspaceBinding } from '../messaging/workspaceBinding'
import { CommandRouter } from '../messaging/commandRouter'
import { createLogger } from '../../platform/logger'

const log = createLogger('FeishuBot')

/** Minimum interval between card edits (Feishu rate: 5 QPS per message). */
const EDIT_THROTTLE_MS = 1200

/**
 * Feishu `im.message.receive_v1` event data shape.
 * Mirrors the SDK-typed handler parameter — extracted here so private methods
 * can reference the type without re-declaring it inline.
 */
interface FeishuMessageEventData {
  sender: {
    sender_id?: { union_id?: string; user_id?: string; open_id?: string }
    sender_type: string
    tenant_key?: string
  }
  message: {
    message_id: string
    root_id?: string
    parent_id?: string
    create_time: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: Array<{ key: string; id: { union_id?: string; user_id?: string; open_id?: string }; name: string }>
  }
}

/**
 * Feishu `card.action.trigger` event data shape.
 * This event is not typed in the Lark SDK — defined from observed runtime shape.
 */
interface FeishuCardActionEventData {
  operator?: { open_id?: string }
  action?: { value?: { action?: string } }
  context?: { open_chat_id?: string }
  open_chat_id?: string
}

export class FeishuBotService {
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private connectionStatus: IMConnectionStatusType = 'disconnected'
  private connectedAt: number | null = null
  private lastError: string | null = null
  private botName: string | null = null
  private messagesReceived = 0
  private messagesSent = 0

  // Streaming state per chat
  private activePlaceholders = new Map<string, {
    messageId: string
    lastEditAt: number
    pendingContent: string | null
    pendingTimer: ReturnType<typeof setTimeout> | null
    inflight: boolean
    sessionId: string
  }>()
  private lastEvoseContent = new Map<string, string>()
  private readonly router = new CommandRouter()

  constructor(private readonly deps: FeishuBotServiceDeps) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    const config = this.deps.getConfig()
    if (!config.appId || !config.appSecret) {
      this.lastError = 'App ID or App Secret not configured'
      this.dispatchStatus()
      return
    }

    this.setStatus('connecting')
    this.dispatchStatus()

    try {
      const sdkDomain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu

      // Create Lark SDK client
      this.client = new lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: sdkDomain,
        loggerLevel: lark.LoggerLevel.warn,
      })

      // Create event dispatcher
      const dispatcher = new lark.EventDispatcher({})

      // Register event handlers
      dispatcher.register({
        'im.message.receive_v1': async (data) => {
          try {
            await this.onMessage(data)
          } catch (err) {
            log.error('Message handler error', err instanceof Error ? err.message : String(err))
          }
        },
        'card.action.trigger': async (data: FeishuCardActionEventData) => {
          try {
            await this.onCardAction(data)
          } catch (err) {
            log.error('Card action handler error', err instanceof Error ? err.message : String(err))
          }
        },
      })

      // Start WebSocket long connection
      this.wsClient = new lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: sdkDomain,
        loggerLevel: lark.LoggerLevel.warn,
      })

      await this.wsClient.start({ eventDispatcher: dispatcher })

      this.setStatus('connected')
      this.connectedAt = Date.now()
      this.lastError = null
      log.info(`Feishu bot started: ${config.name} (${config.appId})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.lastError = msg
      this.setStatus('error')
      log.error(`Feishu bot start failed: ${msg}`)
    }

    this.dispatchStatus()
  }

  stop(): void {
    this.wsClient?.close()
    this.wsClient = null
    this.client = null
    this.activePlaceholders.clear()
    this.lastEvoseContent.clear()
    this.setStatus('disconnected')
    this.connectedAt = null
    this.dispatchStatus()
    log.info(`Feishu bot stopped: ${this.deps.getConfig().name}`)
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const config = this.deps.getConfig()
    if (!config.appId || !config.appSecret) {
      return { success: false, error: 'App ID or App Secret not configured' }
    }

    try {
      const sdkDomain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu
      const testClient = new lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
        domain: sdkDomain,
        loggerLevel: lark.LoggerLevel.error,
      })

      // Try to get bot info to verify credentials
      const resp = await testClient.contact.user.get({
        path: { user_id: config.appId },
        params: { user_id_type: 'app_id' as unknown as 'user_id' },
      })

      // Even if the user lookup fails, getting a non-auth error means creds are valid
      if (resp.code === 0 || resp.code === 10003 || resp.code === 10010) {
        return { success: true }
      }

      // Auth-related error codes
      if (resp.code === 10014 || resp.code === 10012) {
        return { success: false, error: `Authentication failed: ${resp.msg}` }
      }

      return { success: true } // Most other errors just mean the specific API isn't relevant
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(): FeishuBotStatus {
    return {
      botId: this.deps.getConfig().id,
      connectionStatus: this.connectionStatus,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      botName: this.botName,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
    }
  }

  // ── Message reception ─────────────────────────────────────────────────────

  /** Check whether a user is allowed to interact with this bot. */
  private isUserAllowed(userId: string): boolean {
    const { allowedUserIds } = this.deps.getConfig()
    return allowedUserIds.length === 0 || allowedUserIds.includes(userId)
  }

  private async onMessage(data: FeishuMessageEventData): Promise<void> {
    const sender = data.sender
    const message = data.message

    if (!sender || !message) return

    // Skip bot's own messages
    if (sender.sender_type === 'app') return

    const senderId = sender.sender_id?.open_id || sender.sender_id?.user_id || ''
    const chatId = message.chat_id

    if (!this.isUserAllowed(senderId)) {
      log.debug(`Permission denied for user ${senderId}`)
      return
    }

    this.messagesReceived++

    // Parse message content
    if (message.message_type === 'text') {
      try {
        const parsed = JSON.parse(message.content)
        const text = (parsed.text || '').trim()
        if (text) {
          await this.handleTextMessage(text, senderId, chatId)
        }
      } catch {
        log.warn('Failed to parse text message content')
      }
    }
    // TODO: Support image messages in the future
  }

  /**
   * Handle card button click — triggered by `card.action.trigger` event.
   *
   * The parsed v2 event data is a flat merge of header + event fields:
   *   - operator.open_id        — the user who clicked
   *   - action.value            — the button's value object ({ action: 'new' | 'clear' | ... })
   *   - context.open_chat_id   — the chat where the card is displayed
   */
  private async onCardAction(data: FeishuCardActionEventData): Promise<void> {
    const chatId: string | undefined =
      data?.context?.open_chat_id || data?.open_chat_id
    const actionValue = data?.action?.value
    const userId: string = data?.operator?.open_id || ''

    if (!chatId || !actionValue?.action) {
      log.debug('onCardAction: missing chatId or action value', { chatId, actionValue })
      return
    }

    if (!this.isUserAllowed(userId)) {
      log.debug(`Card action permission denied for user ${userId}`)
      return
    }

    this.messagesReceived++
    log.info(`Card action: ${actionValue.action} from user=${userId} chat=${chatId}`)
    await this.executeAction(actionValue.action, {}, userId, chatId)
  }

  private async handleTextMessage(text: string, userId: string, chatId: string): Promise<void> {
    // Strip @mention prefix if present
    const cleanText = text.replace(/@\S+\s*/u, '').trim()
    if (!cleanText) return

    const { action, args } = this.router.parse(cleanText)
    await this.executeAction(action, args, userId, chatId)
  }

  /**
   * Core command execution — the single source of truth for all user actions.
   * Called from both text messages (via CommandRouter) and card button clicks (directly).
   *
   * Routing:
   *   - `chat` action → handled by `handleChat()` using shared `routeIMMessage()`
   *   - All other actions → delegated to shared `executeCommand()`, result translated
   *     by `renderCommandResult()` into Feishu-specific UX (cards, text messages).
   */
  private async executeAction(
    action: string,
    args: Record<string, string>,
    userId: string,
    chatId: string,
  ): Promise<void> {
    // ── chat action: shared session routing ────────────────────────────────
    if (action === 'chat') {
      await this.handleChat(args.prompt || '', userId, chatId)
      return
    }

    // ── All other actions → shared command handler ────────────────────────
    const config = this.deps.getConfig()
    const ctx: CommandContext = {
      orchestrator: this.deps.orchestrator,
      platform: 'feishu',
      connectionId: config.id,
      chatId,
      origin: this.getFeishuOrigin(chatId),
      newSessionDefaults: {
        workspace: resolveUserWorkspaceBinding(config.defaultWorkspace),
      },
      onSessionEnd: () => this.releaseStreamingState(chatId),
    }

    const result = await executeCommand(action, args, ctx)
    await this.renderCommandResult(result, chatId)
  }

  /**
   * Translate a semantic `CommandResult` into Feishu-specific UX.
   *
   * Feishu Presentation Layer: maps semantic results to Feishu Interactive Cards
   * or plain text messages depending on the result type.
   */
  private async renderCommandResult(result: CommandResult, chatId: string): Promise<void> {
    switch (result.type) {
      case 'noop':
        return

      case 'prompt_required':
        await this.sendTextToChat(chatId, 'Please enter your message. Example: `/new write a sorting algorithm`')
        return

      case 'missing_argument':
        await this.sendTextToChat(chatId, `❌ Missing <${result.argument}> for /${result.command}. Example: /reply <sessionId> <message>`)
        return

      case 'session_cleared':
        await this.sendTextToChat(chatId, '✅ Current session has been cleared')
        return

      case 'session_stopped':
        await this.sendTextToChat(chatId, `⏹️ Session ${result.sessionId.slice(0, 8)} has been stopped`)
        return

      case 'no_active_session':
        await this.sendTextToChat(chatId, 'No active session')
        return

      case 'session_not_found':
        await this.sendTextToChat(chatId, `❌ Session not found: ${result.query}`)
        return

      case 'session_busy':
        await this.sendTextToChat(chatId, '⏳ Current session is being processed, please wait...\n\nSend /new to start a new session')
        return

      case 'stop_failed':
        await this.sendTextToChat(chatId, `❌ Stop failed`)
        return

      case 'reply_sent':
        return // Streaming response is the feedback

      case 'reply_failed':
        await this.sendTextToChat(chatId, `❌ Session ${result.sessionId.slice(0, 8)} could not be resumed`)
        return

      case 'session_list':
        await this.sendCardToChat(
          chatId,
          buildStatusCard(result.sessions.map((s) => ({ id: s.id, name: s.id.slice(0, 8), state: s.state }))),
        )
        return

      case 'issues':
        await this.sendTextToChat(chatId, '📋 Issues feature coming soon, stay tuned!')
        return

      case 'inbox':
        await this.sendTextToChat(chatId, '📬 Inbox feature coming soon, stay tuned!')
        return

      case 'menu':
        await this.sendCardToChat(chatId, buildMenuCard())
        return

      case 'help':
        await this.sendCardToChat(chatId, buildHelpCard())
        return

      case 'error': {
        const msg = result.cause instanceof Error ? result.cause.message : String(result.cause)
        await this.sendTextToChat(chatId, `❌ Execution error: ${msg}`)
        return
      }

      default:
        await this.sendCardToChat(chatId, buildHelpCard())
        return
    }
  }

  private async handleChat(text: string, _userId: string, chatId: string): Promise<void> {
    if (!text) return

    const config = this.deps.getConfig()
    const result = await routeIMMessage({
      orchestrator: this.deps.orchestrator,
      content: [{ type: 'text' as const, text }],
      origin: this.getFeishuOrigin(chatId),
      connectionId: config.id,
      chatId,
      newSessionDefaults: {
        workspace: resolveUserWorkspaceBinding(config.defaultWorkspace),
      },
    })

    if (result.outcome === 'busy') {
      await this.sendTextToChat(chatId, '⏳ Current session is being processed, please wait...\n\nSend /new to start a new session')
    } else if (result.outcome === 'error') {
      await this.sendTextToChat(chatId, '❌ Failed to start session, please try again later')
    }
  }

  // ── Assistant message handling (streaming) ────────────────────────────────

  async handleAssistantMessage(
    _origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const chatId = this.extractChatId(_origin)
    if (!chatId || !this.client) return

    if (!('content' in message) || message.role !== 'assistant') return
    const blocks = message.content
    const textContent = extractTextFromBlocks(blocks)

    if (message.isStreaming) {
      if (!textContent) return

      // Commit any Evose progress before starting Claude stream
      await this.commitEvoseProgress(chatId)

      const cardJson = buildStreamingCard({
        content: textContent,
        isStreaming: true,
        sessionId,
      })

      await this.sendOrEditCard(chatId, cardJson, sessionId)
    } else {
      // Final message
      await this.commitEvoseProgress(chatId)

      if (!textContent) return

      const chunks = splitForFeishu(textContent)
      const state = this.activePlaceholders.get(chatId)

      if (state && chunks.length > 0) {
        // Edit first chunk into existing placeholder
        const finalCard = buildFinalCard(chunks[0])
        await this.editCard(chatId, state.messageId, finalCard)
        this.activePlaceholders.delete(chatId)

        // Send remaining chunks as new messages
        for (let i = 1; i < chunks.length; i++) {
          await this.sendCardToChat(chatId, buildFinalCard(chunks[i]))
        }
      } else {
        // No placeholder — send all as new messages
        this.activePlaceholders.delete(chatId)
        for (const chunk of chunks) {
          await this.sendCardToChat(chatId, buildFinalCard(chunk))
        }
      }
    }
  }

  async handleEvoseProgress(
    _origin: SessionOrigin,
    message: ManagedSessionMessage,
    sessionId: string,
  ): Promise<void> {
    const chatId = this.extractChatId(_origin)
    if (!chatId || !this.client) return

    if (!('content' in message)) return
    const blocks = message.content
    const activity = extractEvoseActivity(blocks)
    if (!activity) return

    this.lastEvoseContent.set(chatId, activity)

    const cardJson = buildStreamingCard({
      content: activity,
      isStreaming: true,
      sessionId,
    })

    await this.sendOrEditCard(chatId, cardJson, sessionId)
  }

  releaseActivePlaceholder(origin: SessionOrigin): void {
    const chatId = this.extractChatId(origin)
    if (chatId) {
      this.releaseStreamingState(chatId)
    }
  }

  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    const chatId = this.extractChatId(origin)
    if (!chatId) return

    this.releaseStreamingState(chatId)

    if (stopReason) {
      await this.sendTextToChat(chatId, `✅ Session completed${stopReason ? `: ${stopReason}` : ''}`)
    }
  }

  // ── Streaming helpers ─────────────────────────────────────────────────────

  private async sendOrEditCard(chatId: string, cardJson: string, sessionId: string): Promise<void> {
    const state = this.activePlaceholders.get(chatId)

    if (!state) {
      // First message — create placeholder
      const messageId = await this.sendCardToChat(chatId, cardJson)
      if (messageId) {
        this.activePlaceholders.set(chatId, {
          messageId,
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
      state.pendingContent = cardJson
      if (!state.inflight && !state.pendingTimer) {
        // Schedule flush after throttle window
        state.pendingTimer = setTimeout(() => {
          state.pendingTimer = null
          this.flushPending(chatId)
        }, EDIT_THROTTLE_MS)
      }
      return
    }

    // Direct edit
    state.inflight = true
    state.lastEditAt = now
    try {
      await this.editCard(chatId, state.messageId, cardJson)
    } finally {
      state.inflight = false
      // Flush any pending content accumulated during in-flight edit
      if (state.pendingContent) {
        const pending = state.pendingContent
        state.pendingContent = null
        await this.sendOrEditCard(chatId, pending, sessionId)
      }
    }
  }

  private async flushPending(chatId: string): Promise<void> {
    const state = this.activePlaceholders.get(chatId)
    if (!state?.pendingContent || state.inflight) return

    const content = state.pendingContent
    state.pendingContent = null
    await this.sendOrEditCard(chatId, content, state.sessionId)
  }

  private async commitEvoseProgress(chatId: string): Promise<void> {
    const content = this.lastEvoseContent.get(chatId)
    if (!content) return

    this.lastEvoseContent.delete(chatId)
    const state = this.activePlaceholders.get(chatId)

    if (state) {
      // Finalize the Evose placeholder into a permanent card
      const finalCard = buildFinalCard(content)
      await this.editCard(chatId, state.messageId, finalCard)
      this.activePlaceholders.delete(chatId)
    }
  }

  private releaseStreamingState(chatId: string): void {
    const state = this.activePlaceholders.get(chatId)
    if (state?.pendingTimer) {
      clearTimeout(state.pendingTimer)
    }
    this.activePlaceholders.delete(chatId)
    this.lastEvoseContent.delete(chatId)
  }

  // ── API wrappers ──────────────────────────────────────────────────────────

  private async sendTextToChat(chatId: string, text: string): Promise<string | null> {
    if (!this.client) return null
    try {
      const resp = await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: buildTextMessage(text),
        },
        params: { receive_id_type: 'chat_id' },
      })
      this.messagesSent++
      return resp.data?.message_id ?? null
    } catch (err) {
      log.error('sendTextToChat failed', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  private async sendCardToChat(chatId: string, cardJson: string): Promise<string | null> {
    if (!this.client) return null
    try {
      const resp = await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: cardJson,
        },
        params: { receive_id_type: 'chat_id' },
      })
      this.messagesSent++
      return resp.data?.message_id ?? null
    } catch (err) {
      log.error('sendCardToChat failed', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  private async editCard(chatId: string, messageId: string, cardJson: string): Promise<void> {
    if (!this.client) return
    try {
      await this.client.im.message.patch({
        data: { content: cardJson },
        path: { message_id: messageId },
      })
    } catch (err) {
      log.warn(`editCard failed (messageId=${messageId})`, err instanceof Error ? err.message : String(err))
    }
  }

  // ── Session helpers ───────────────────────────────────────────────────────

  private async findActiveSession(chatId: string): Promise<SessionSnapshot | null> {
    const config = this.deps.getConfig()
    return findActiveIMSession({
      orchestrator: this.deps.orchestrator,
      platform: 'feishu',
      connectionId: config.id,
      chatId,
    })
  }

  private getFeishuOrigin(chatId: string): SessionOrigin {
    return {
      source: 'feishu',
      appId: this.deps.getConfig().id,
      chatId,
    }
  }

  private extractChatId(origin: SessionOrigin): string | null {
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
        platform: 'feishu',
        connectionStatus: this.connectionStatus,
        connectedAt: this.connectedAt,
        lastError: this.lastError,
        metadata: {
          botUsername: this.botName ?? undefined,
          messagesReceived: this.messagesReceived,
          messagesSent: this.messagesSent,
        },
      },
    })
  }
}
