// SPDX-License-Identifier: Apache-2.0

/**
 * WeixinBotService — core service for a single WeChat bot connection.
 *
 * Implements the BaseBotService contract: start/stop lifecycle, message routing,
 * status queries, and connection testing.
 *
 * Architecture:
 *   - Long-polling loop (getUpdates) for inbound messages
 *   - context_token cache for outbound reply correlation (iLink requirement)
 *   - Session guard for errcode -14 (session expired) with 1-hour cooldown
 *   - Reuses shared CommandRouter, sessionRouter, and commandHandler
 *   - Proactive status dispatch — every state change broadcasts to the DataBus
 */

import type {
  IMConnectionStatusType,
  ManagedSessionMessage,
  SessionOrigin,
  DataBusEvent,
  IMOrchestratorDeps,
  ImageBlock,
  ContentBlock,
} from '../../../src/shared/types'
import type { WeixinOrigin } from '../messaging/types'
import type { WeixinBotEntry, WeixinBotStatus, WeixinMessage } from './types'
import { MessageType, MessageItemType, UploadMediaType, SESSION_EXPIRED_ERRCODE } from './types'
import { WeixinILinkClient, DEFAULT_ILINK_BASE_URL } from './weixinILinkClient'
import { uploadMediaBuffer } from './weixinCdnUpload'
import { buildImageItem } from './weixinMessageBuilder'
import { CommandRouter } from '../messaging/commandRouter'
import { routeIMMessage } from '../messaging/sessionRouter'
import { executeCommand } from '../messaging/commandHandler'
import type { CommandResult, SessionSummary } from '../messaging/commandHandler'
import { resolveUserWorkspaceBinding } from '../messaging/workspaceBinding'
import { extractTextFromBlocks } from '../messaging/contentExtractor'
import { splitMessage } from '../messaging/messageSplitter'
import { createLogger } from '../../platform/logger'
import type { IssueService } from '../issueService'
import type { ProjectService } from '../projectService'

const log = createLogger('WeixinBot')

// ── Error recovery constants ─────────────────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 3
const BACKOFF_DELAY_MS = 30_000
const RETRY_DELAY_MS = 2_000
const SESSION_PAUSE_DURATION_MS = 60 * 60 * 1000  // 1 hour

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface WeixinBotServiceDeps {
  dispatch: (event: DataBusEvent) => void
  getConfig: () => WeixinBotEntry
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
}

// ── Service ──────────────────────────────────────────────────────────────────

export class WeixinBotService {
  private client: WeixinILinkClient | null = null
  private polling = false
  private abortController: AbortController | null = null
  private readonly router = new CommandRouter()

  // ── State ───────────────────────────────────────────────────────────────
  private connectionStatus: IMConnectionStatusType = 'disconnected'
  private connectedAt: number | null = null
  private lastError: string | null = null
  private messagesReceived = 0
  private messagesSent = 0

  /** Cursor for getUpdates — persists across poll cycles. */
  private cursor = ''

  /**
   * context_token cache: userId → latest context_token.
   * iLink protocol REQUIRES this token to be echoed back in every outbound message.
   * Without it, replies are silently dropped.
   */
  private readonly contextTokenCache = new Map<string, string>()

  /** Session pause state for errcode -14 recovery. */
  private pausedUntil: number | null = null

  constructor(private readonly deps: WeixinBotServiceDeps) {}

  // ── Lifecycle (BaseBotService contract) ────────────────────────────────

  async start(): Promise<void> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      log.warn('start: no botToken configured, skipping', { id: config.id })
      this.setStatus('error', 'No bot token. Please scan QR code to connect.')
      return
    }

    this.setStatus('connecting')

    this.client = new WeixinILinkClient({
      baseUrl: config.baseUrl || DEFAULT_ILINK_BASE_URL,
      token: config.botToken,
      fetch: this.deps.fetch,
    })

    this.abortController = new AbortController()
    this.polling = true

    log.info('Starting WeChat bot polling', { id: config.id, name: config.name })

    // Start polling in background — first successful poll will transition to 'connected'.
    // Unlike token-based bots (Telegram, Discord), iLink doesn't have a lightweight
    // "validate token" API, so the first getUpdates cycle doubles as connection verification.
    this.pollLoop().catch((err) => {
      if (this.polling) {
        log.error('pollLoop exited unexpectedly', err)
        this.setStatus('error', err instanceof Error ? err.message : String(err))
      }
    })
  }

  stop(): void {
    this.polling = false
    this.abortController?.abort()
    this.abortController = null
    this.client = null
    this.connectedAt = null
    this.contextTokenCache.clear()
    this.setStatus('disconnected')
    log.info('Stopped WeChat bot', { id: this.deps.getConfig().id })
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    const config = this.deps.getConfig()
    if (!config.botToken) {
      return { success: false, error: 'No bot token configured. Scan QR code first.' }
    }
    try {
      const testClient = new WeixinILinkClient({
        baseUrl: config.baseUrl || DEFAULT_ILINK_BASE_URL,
        token: config.botToken,
        fetch: this.deps.fetch,
      })
      // A lightweight getUpdates with empty cursor — if the token is valid, it returns ret=0
      const resp = await testClient.getUpdates('')
      if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
        return { success: false, error: 'Session expired. Please re-scan QR code.' }
      }
      if (resp.ret !== undefined && resp.ret !== 0) {
        return { success: false, error: `API error: ret=${resp.ret} ${resp.errmsg ?? ''}` }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  getStatus(): WeixinBotStatus {
    return {
      connectionId: this.deps.getConfig().id,
      connectionStatus: this.connectionStatus,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
    }
  }

  // ── Message routing (BaseBotService contract) ──────────────────────────

  async handleAssistantMessage(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    _sessionId: string,
  ): Promise<void> {
    // Skip streaming partials — iLink has no "edit message" API, so sending
    // every intermediate chunk would flood the user with ~200 messages per
    // response. We wait for the finalized message (isStreaming=false).
    if ('isStreaming' in message && message.isStreaming) return
    await this.relayToUser(origin, message)
  }

  async handleEvoseProgress(
    origin: SessionOrigin,
    message: ManagedSessionMessage,
    _sessionId: string,
  ): Promise<void> {
    // Skip streaming partials for the same reason as handleAssistantMessage.
    if ('isStreaming' in message && message.isStreaming) return
    await this.relayToUser(origin, message)
  }

  /**
   * Extract text AND images from a session message and send them to the WeChat user.
   * Shared by handleAssistantMessage and handleEvoseProgress.
   *
   * Images are uploaded to the Weixin CDN (AES-128-ECB encrypted) and sent as
   * IMAGE items. Text is sent as plain text with long-message splitting.
   * Each image is sent as a separate message (iLink requires one item per message).
   */
  private async relayToUser(origin: SessionOrigin, message: ManagedSessionMessage): Promise<void> {
    if (origin.source !== 'weixin') return

    if (!('content' in message)) return
    const blocks = message.content
    const text = extractTextFromBlocks(blocks)
    const imageBlocks = blocks.filter((b: ContentBlock): b is ImageBlock => b.type === 'image')

    // Send text first (if any)
    if (text) {
      await this.sendTextMessage(origin.userId, text)
    }

    // Send images (each as a separate message — iLink requires one item per message)
    for (const img of imageBlocks) {
      try {
        await this.sendImageToUser(origin.userId, img)
      } catch (err) {
        log.error('Failed to send image to WeChat user', {
          userId: origin.userId,
          mediaType: img.mediaType,
          sizeBytes: img.sizeBytes,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  releaseActivePlaceholder(_origin: SessionOrigin): void {
    // No-op for WeChat Phase 1 — no streaming placeholders
  }

  async notifySessionDone(origin: SessionOrigin, stopReason?: string): Promise<void> {
    if (origin.source !== 'weixin') return
    if (stopReason) {
      // Platform-neutral message — the stopReason already describes the outcome
      await this.sendTextMessage(origin.userId, stopReason)
    }
  }

  // ── Long-Polling loop ──────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    let consecutiveFailures = 0

    while (this.polling && !this.abortController?.signal.aborted) {
      // Check session pause
      if (this.pausedUntil && Date.now() < this.pausedUntil) {
        await this.sleep(Math.min(this.pausedUntil - Date.now(), 60_000))
        continue
      }
      this.pausedUntil = null

      try {
        const resp = await this.client!.getUpdates(this.cursor)

        // Check for API errors
        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0)

        if (isApiError) {
          const isSessionExpired =
            resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE

          if (isSessionExpired) {
            this.pausedUntil = Date.now() + SESSION_PAUSE_DURATION_MS
            this.setStatus('error', 'Session expired. Please re-scan QR code.')
            log.error('Session expired (errcode -14), pausing for 1 hour', {
              id: this.deps.getConfig().id,
            })
            consecutiveFailures = 0
            continue
          }

          consecutiveFailures++
          log.error(`getUpdates failed: ret=${resp.ret} errcode=${resp.errcode}`, {
            errmsg: resp.errmsg,
            failures: consecutiveFailures,
          })

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0
            await this.sleep(BACKOFF_DELAY_MS)
          } else {
            await this.sleep(RETRY_DELAY_MS)
          }
          continue
        }

        // Success — reset failure counter and confirm connection
        consecutiveFailures = 0
        if (this.connectionStatus !== 'connected') {
          this.connectedAt = Date.now()
          this.setStatus('connected')
        }

        // Update cursor
        if (resp.get_updates_buf) {
          this.cursor = resp.get_updates_buf
        }

        // Process inbound messages
        const messages = resp.msgs ?? []
        for (const msg of messages) {
          await this.handleInboundMessage(msg)
        }
      } catch (err) {
        if (!this.polling || this.abortController?.signal.aborted) return

        consecutiveFailures++
        const errMsg = err instanceof Error ? err.message : String(err)
        log.error(`getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`)

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          consecutiveFailures = 0
          await this.sleep(BACKOFF_DELAY_MS)
        } else {
          await this.sleep(RETRY_DELAY_MS)
        }
      }
    }
  }

  // ── Inbound message processing ─────────────────────────────────────────

  private async handleInboundMessage(msg: WeixinMessage): Promise<void> {
    // Only process user-to-bot messages
    if (msg.message_type !== MessageType.USER) return

    const userId = msg.from_user_id ?? ''
    if (!userId) return

    // Cache context_token (CRITICAL for iLink protocol)
    if (msg.context_token) {
      this.contextTokenCache.set(userId, msg.context_token)
    }

    // Extract text content — prioritize explicit text, fall back to voice transcription
    const textContent = msg.item_list
      ?.find((item) => item.type === MessageItemType.TEXT)
      ?.text_item?.text ?? ''

    const voiceTranscription = msg.item_list
      ?.find((item) => item.type === MessageItemType.VOICE)
      ?.voice_item?.text

    const messageText = textContent || voiceTranscription || ''

    if (!messageText) {
      log.debug('Ignoring non-text message', { userId, types: msg.item_list?.map((i) => i.type) })
      return
    }

    this.messagesReceived++

    // ACL check
    const config = this.deps.getConfig()
    if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
      log.debug('Message from unauthorized user, ignoring', { userId })
      return
    }

    // Build origin
    const origin: WeixinOrigin = {
      source: 'weixin',
      connectionId: config.id,
      userId,
    }

    // Per-message error boundary — prevents a single bad message from poisoning
    // the pollLoop's consecutiveFailures counter and triggering the backoff logic.
    try {
      // Parse command
      const parsed = this.router.parse(messageText)

      if (parsed.action === 'chat') {
        // Regular chat — route to session
        await routeIMMessage({
          orchestrator: this.deps.orchestrator,
          content: [{ type: 'text' as const, text: messageText }],
          origin,
          connectionId: config.id,
          chatId: userId,
          newSessionDefaults: {
            workspace: resolveUserWorkspaceBinding(config.defaultWorkspace),
          },
        })
      } else {
        // Command — execute and render result
        const result = await executeCommand(parsed.action, parsed.args, {
          orchestrator: this.deps.orchestrator,
          platform: 'weixin',
          connectionId: config.id,
          chatId: userId,
          origin,
          newSessionDefaults: {
            workspace: resolveUserWorkspaceBinding(config.defaultWorkspace),
          },
        })
        const text = this.renderCommandResult(result)
        if (text) {
          await this.sendTextMessage(userId, text)
        }
      }
    } catch (err) {
      log.error('Failed to process inbound message', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // ── Command result rendering ──────────────────────────────────────────

  /**
   * Render a semantic CommandResult to a plain-text string suitable for WeChat.
   * Returns null when no reply is needed (e.g. streaming will handle it).
   *
   * This is the WeChat equivalent of Telegram's `renderCommandResult()`.
   * WeChat doesn't support rich formatting (no Markdown, no inline keyboards),
   * so all results are rendered as plain text with emoji indicators.
   */
  private renderCommandResult(result: CommandResult): string | null {
    switch (result.type) {
      case 'noop':
      case 'reply_sent':
        // Streaming response is the feedback — no separate reply needed
        return null

      case 'prompt_required':
        return '💬 Enter what you want to discuss:'

      case 'missing_argument':
        return `❌ Missing <${result.argument}> for /${result.command}.\nExample: /reply <sessionId> <message>`

      case 'session_cleared':
        return '🗑️ Session cleared. Send a message to start a new conversation.'

      case 'session_stopped':
        return `⏹️ Session ${result.sessionId.slice(0, 8)} stopped.`

      case 'no_active_session':
        return '✨ No active session. Send a message to start a new conversation.'

      case 'session_not_found':
        return `❌ Session not found: ${result.query}`

      case 'session_busy':
        return '⏳ Still processing, please wait...\n\nSend /new to start a new session.'

      case 'stop_failed':
        return `❌ Failed to stop session ${result.sessionId.slice(0, 8)}.`

      case 'reply_failed':
        return '❌ Reply failed: session may have ended.'

      case 'session_list':
        return this.formatSessionList(result.sessions)

      case 'help':
      case 'menu':
        return this.formatHelpText()

      case 'issues':
        return '📋 Issues feature: use /issues in the app for a richer experience.'

      case 'inbox':
        return '📬 Inbox feature coming soon.'

      case 'error': {
        const msg = result.cause instanceof Error ? result.cause.message : String(result.cause)
        return `❌ Error: ${msg}`
      }

      default: {
        // Exhaustiveness guard — ensures all CommandResult.type variants are handled.
        // If a new variant is added to CommandResult, TypeScript will flag this line.
        const _exhaustive: never = result
        return null
      }
    }
  }

  private formatSessionList(sessions: readonly SessionSummary[]): string {
    if (sessions.length === 0) {
      return '📋 No active sessions.'
    }
    const lines = sessions.map(
      (s) => `• ${s.id.slice(0, 8)} [${s.state}]${s.activity ? ` — ${s.activity}` : ''}`,
    )
    return `📋 Sessions (${sessions.length}):\n${lines.join('\n')}`
  }

  private formatHelpText(): string {
    return [
      '📖 Commands:',
      '  /new [prompt] — Start a new conversation',
      '  /clear — Clear current session',
      '  /stop [id] — Stop a session',
      '  /reply <id> <msg> — Reply to a session',
      '  /status — List active sessions',
      '  /help — Show this help',
    ].join('\n')
  }

  // ── Outbound messaging ─────────────────────────────────────────────────

  private async sendTextMessage(userId: string, text: string): Promise<void> {
    if (!this.client) return

    const contextToken = this.contextTokenCache.get(userId)
    if (!contextToken) {
      // Match official SDK: warn but attempt send (server may accept without context)
      log.warn('contextToken missing, attempting text send without context', { userId })
    }

    // Split long messages (WeChat has ~4096 char soft limit)
    const chunks = splitMessage(text, 4096)
    for (const chunk of chunks) {
      try {
        await this.client.sendMessage(userId, chunk, contextToken ?? '')
        this.messagesSent++
      } catch (err) {
        log.error('sendMessage failed', { userId, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /**
   * Upload an image to the Weixin CDN and send it as an IMAGE message.
   *
   * Flow: base64 → Buffer → CDN upload (AES-128-ECB) → buildImageItem → sendMediaItem
   *
   * Separation of concerns:
   *   - CDN upload:     `uploadMediaBuffer()` in weixinCdnUpload.ts
   *   - Item building:  `buildImageItem()` in weixinMessageBuilder.ts
   *   - Sending:        `client.sendMediaItem()` in weixinILinkClient.ts
   */
  private async sendImageToUser(userId: string, image: ImageBlock): Promise<void> {
    if (!this.client) return

    const contextToken = this.contextTokenCache.get(userId)
    if (!contextToken) {
      // Match official SDK behavior: warn but still attempt the send.
      // contextToken may be empty for the very first outbound message before
      // any inbound message has been received, but the server may accept it.
      log.warn('contextToken missing, attempting send without context', { userId })
    }

    const buffer = Buffer.from(image.data, 'base64')
    log.info('Uploading image to CDN', {
      userId,
      bytes: buffer.length,
      mediaType: image.mediaType,
    })

    // Step 1: CDN upload (encrypt + upload)
    const uploaded = await uploadMediaBuffer({
      buffer,
      toUserId: userId,
      mediaType: UploadMediaType.IMAGE,
      client: this.client,
      fetchFn: this.deps.fetch,
    })

    log.info('CDN upload complete, sending IMAGE message', {
      userId,
      filekey: uploaded.filekey,
      fileSize: uploaded.fileSize,
    })

    // Step 2: Build protocol item + send (encoding rules encapsulated in builder)
    await this.client.sendMediaItem(
      userId,
      buildImageItem(uploaded),
      contextToken ?? '',
    )

    this.messagesSent++
  }

  // ── Status management ─────────────────────────────────────────────────

  /**
   * Atomically update connection status and broadcast to the DataBus.
   * Every caller that mutates connectionStatus MUST go through this method
   * to ensure the Renderer receives real-time status updates.
   */
  private setStatus(status: IMConnectionStatusType, error?: string): void {
    this.connectionStatus = status
    this.lastError = error ?? null
    this.dispatchStatus()
  }

  /** Broadcast the current status to the DataBus → Renderer via IPC. */
  private dispatchStatus(): void {
    const s = this.getStatus()
    this.deps.dispatch({
      type: 'messaging:status',
      payload: {
        connectionId: s.connectionId,
        platform: 'weixin',
        connectionStatus: s.connectionStatus,
        connectedAt: s.connectedAt,
        lastError: s.lastError,
        metadata: {
          messagesReceived: s.messagesReceived,
          messagesSent: s.messagesSent,
        },
      },
    })
  }

  // ── Utility ────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      this.abortController?.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
  }
}
