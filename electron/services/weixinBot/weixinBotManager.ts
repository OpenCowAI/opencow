// SPDX-License-Identifier: Apache-2.0

/**
 * WeixinBotManager — orchestrates the lifecycle of WeChat bot instances.
 *
 * Extends BaseBotManager for shared lifecycle, config sync, status query,
 * and message routing. Only implements the 3 abstract factory/routing methods.
 *
 * Also manages QR code login sessions (platform-specific feature).
 * Token persistence is delegated to an injected callback (`onTokenAcquired`)
 * so the Manager remains decoupled from SettingsService.
 */

import type {
  DataBusEvent,
  IMOrchestratorDeps,
} from '../../../src/shared/types'
import { BaseBotManager } from '../messaging/baseBotManager'
import type { WeixinOrigin } from '../messaging/types'
import type { WeixinBotEntry, WeixinBotStatus } from './types'
import { WeixinBotService } from './weixinBotService'
import { WeixinAuthSession } from './weixinAuth'
import type { QRCodeLoginResult } from './weixinAuth'
import { DEFAULT_ILINK_BASE_URL } from './weixinILinkClient'
import type { IssueService } from '../issueService'
import type { ProjectService } from '../projectService'
import { createLogger } from '../../platform/logger'

const log = createLogger('WeixinBotManager')

export interface WeixinBotManagerDeps {
  dispatch: (event: DataBusEvent) => void
  fetch?: typeof globalThis.fetch
  orchestrator: IMOrchestratorDeps
  issueService: IssueService
  projectService: ProjectService
  /**
   * Callback invoked when QR login yields a new bot token.
   * The caller (main.ts) is responsible for persisting the token
   * to SettingsService so it survives app restarts.
   */
  onTokenAcquired: (connectionId: string, credentials: { botToken: string; baseUrl?: string }) => Promise<void>
}

export class WeixinBotManager extends BaseBotManager<
  WeixinBotEntry,
  WeixinBotService,
  WeixinBotStatus,
  WeixinOrigin
> {
  /** Active QR login sessions, keyed by connectionId. */
  private readonly qrSessions = new Map<string, WeixinAuthSession>()

  constructor(private readonly deps: WeixinBotManagerDeps) {
    super()
  }

  // ── Abstract implementations ────────────────────────────────────────────

  protected createService(entryId: string): WeixinBotService {
    return new WeixinBotService({
      getConfig: () => {
        const entry = this.entries.get(entryId)
        if (!entry) throw new Error(`WeixinBotManager: entry ${entryId} not found`)
        return entry
      },
      dispatch:       this.deps.dispatch,
      fetch:          this.deps.fetch,
      orchestrator:   this.deps.orchestrator,
      issueService:   this.deps.issueService,
      projectService: this.deps.projectService,
    })
  }

  protected getOriginConnectionId(origin: WeixinOrigin): string {
    return origin.connectionId
  }

  protected isRestartRequired(oldEntry: WeixinBotEntry, newEntry: WeixinBotEntry): boolean {
    return oldEntry.botToken !== newEntry.botToken
        || oldEntry.baseUrl  !== newEntry.baseUrl
  }

  // ── QR Code Login Management ───────────────────────────────────────────

  /**
   * Start a QR code login flow for the given connection.
   * Emits DataBus events that the Renderer listens to for UI updates.
   * On success, persists the token via `onTokenAcquired` callback.
   */
  async startQRLogin(connectionId: string): Promise<void> {
    // Cancel any existing session for this connection
    this.cancelQRLogin(connectionId)

    const entry = this.entries.get(connectionId)
    const baseUrl = entry?.baseUrl || DEFAULT_ILINK_BASE_URL

    const session = new WeixinAuthSession(
      {
        onQRCodeReady: (qrcodeImageContent: string) => {
          this.deps.dispatch({
            type: 'messaging:weixin-qr-ready',
            payload: { connectionId, qrcodeImageContent },
          })
        },
        onQRCodeScanned: () => {
          this.deps.dispatch({
            type: 'messaging:weixin-qr-scanned',
            payload: { connectionId },
          })
        },
        onLoginSuccess: (_result: QRCodeLoginResult) => {
          this.qrSessions.delete(connectionId)
          this.deps.dispatch({
            type: 'messaging:weixin-qr-login-success',
            payload: { connectionId },
          })
          log.info(`QR login succeeded for connection ${connectionId}`)
        },
        onLoginFailed: (error: string) => {
          this.qrSessions.delete(connectionId)
          this.deps.dispatch({
            type: 'messaging:weixin-qr-login-failed',
            payload: { connectionId, error },
          })
          log.warn(`QR login failed for connection ${connectionId}: ${error}`)
        },
      },
      this.deps.fetch ?? globalThis.fetch,
    )

    this.qrSessions.set(connectionId, session)

    const result = await session.start(baseUrl)

    // Persist acquired credentials — both in-memory and to disk via callback
    if (result) {
      // 1. Update in-memory entry (so the service can start immediately)
      const existing = this.entries.get(connectionId)
      if (existing) {
        existing.botToken = result.botToken
        if (result.baseUrl) {
          existing.baseUrl = result.baseUrl
        }
      }

      // 2. Persist to SettingsService (survives app restart)
      try {
        await this.deps.onTokenAcquired(connectionId, {
          botToken: result.botToken,
          baseUrl: result.baseUrl,
        })
      } catch (err) {
        log.error('Failed to persist QR login token to settings', err)
      }
    }
  }

  /** Cancel an in-progress QR login attempt. */
  cancelQRLogin(connectionId: string): void {
    const session = this.qrSessions.get(connectionId)
    if (session) {
      session.cancel()
      this.qrSessions.delete(connectionId)
    }
  }
}
