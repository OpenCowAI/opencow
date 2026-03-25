// SPDX-License-Identifier: Apache-2.0

/**
 * WeChat iLink HTTP client — minimal protocol adapter for ilinkai.weixin.qq.com.
 *
 * Derived from `@tencent-weixin/openclaw-weixin` v1.0.2 (api/api.ts).
 * Stripped of OpenClaw-specific dependencies (loadConfigRouteTag, plugin SDK, etc.).
 */

import crypto from 'node:crypto'

import type {
  ILinkBaseInfo,
  GetUpdatesResp,
  SendMessageReq,
  SendTypingReq,
  GetConfigResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  QRCodeResponse,
  QRCodeStatusResponse,
  WeixinMessage,
  MessageItem,
} from './types'
import { MessageType, MessageState, MessageItemType, TypingStatus } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('WeixinILink')

export const DEFAULT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CHANNEL_VERSION = '1.0.3'

/** Default timeout for long-poll getUpdates requests. */
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000
/** Default timeout for regular API requests (sendMessage, getUploadUrl). */
const DEFAULT_API_TIMEOUT_MS = 15_000
/** Default timeout for lightweight API requests (getConfig, sendTyping). */
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000
/** Client-side timeout for the long-poll get_qrcode_status request. */
const QR_LONG_POLL_TIMEOUT_MS = 35_000

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

/** Build the `base_info` payload included in every API request. */
function buildBaseInfo(): ILinkBaseInfo {
  return { channel_version: CHANNEL_VERSION }
}

/**
 * X-WECHAT-UIN header: random uint32 → decimal string → base64.
 * Anti-replay mechanism required by the iLink protocol.
 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(opts.body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
  }
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`
  }
  return headers
}

/**
 * Common fetch wrapper: POST JSON to a Weixin API endpoint with timeout + abort.
 * Returns the raw response text on success; throws on HTTP error or timeout.
 */
async function apiFetch(params: {
  baseUrl: string
  endpoint: string
  body: string
  token?: string
  timeoutMs: number
  label: string
  fetchFn: typeof globalThis.fetch
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl)
  const url = new URL(params.endpoint, base)
  const hdrs = buildHeaders({ token: params.token, body: params.body })

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    const res = await params.fetchFn(url.toString(), {
      method: 'POST',
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    })
    clearTimeout(t)
    const rawText = await res.text()
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`)
    }
    return rawText
  } catch (err) {
    clearTimeout(t)
    throw err
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface ILinkClientConfig {
  baseUrl: string
  token: string
  fetch?: typeof globalThis.fetch
}

/**
 * Stateless iLink API client. All methods are pure HTTP calls.
 * State management (cursor, contextToken, auth) is handled by the caller.
 */
export class WeixinILinkClient {
  private readonly baseUrl: string
  private token: string
  private readonly fetchFn: typeof globalThis.fetch

  constructor(config: ILinkClientConfig) {
    this.baseUrl = config.baseUrl || DEFAULT_ILINK_BASE_URL
    this.token   = config.token
    this.fetchFn = config.fetch ?? globalThis.fetch
  }

  /** Update the bot token (e.g. after re-login). */
  setToken(token: string): void {
    this.token = token
  }

  // ── getUpdates (long-poll) ──────────────────────────────────────────────

  async getUpdates(cursor: string): Promise<GetUpdatesResp> {
    try {
      const rawText = await apiFetch({
        baseUrl: this.baseUrl,
        endpoint: 'ilink/bot/getupdates',
        body: JSON.stringify({
          get_updates_buf: cursor,
          base_info: buildBaseInfo(),
        }),
        token: this.token,
        timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
        label: 'getUpdates',
        fetchFn: this.fetchFn,
      })
      return JSON.parse(rawText) as GetUpdatesResp
    } catch (err) {
      // Long-poll timeout is normal; return empty response so caller can retry
      if (err instanceof Error && err.name === 'AbortError') {
        log.debug('getUpdates: client-side timeout, returning empty response')
        return { ret: 0, msgs: [], get_updates_buf: cursor }
      }
      throw err
    }
  }

  // ── sendMessage ─────────────────────────────────────────────────────────

  async sendMessage(toUserId: string, text: string, contextToken: string): Promise<void> {
    const msg: WeixinMessage = {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: `opencow-weixin-${crypto.randomUUID()}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [{ type: MessageItemType.TEXT, text_item: { text } }],
    }
    await apiFetch({
      baseUrl: this.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      body: JSON.stringify({ msg, base_info: buildBaseInfo() } satisfies SendMessageReq),
      token: this.token,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      label: 'sendMessage',
      fetchFn: this.fetchFn,
    })
  }

  // ── getConfig (typing_ticket) ───────────────────────────────────────────

  async getConfig(ilinkUserId: string, contextToken?: string): Promise<GetConfigResp> {
    const rawText = await apiFetch({
      baseUrl: this.baseUrl,
      endpoint: 'ilink/bot/getconfig',
      body: JSON.stringify({
        ilink_user_id: ilinkUserId,
        context_token: contextToken,
        base_info: buildBaseInfo(),
      }),
      token: this.token,
      timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
      label: 'getConfig',
      fetchFn: this.fetchFn,
    })
    return JSON.parse(rawText) as GetConfigResp
  }

  // ── sendTyping ──────────────────────────────────────────────────────────

  async sendTyping(ilinkUserId: string, typingTicket: string): Promise<void> {
    const req: SendTypingReq = {
      ilink_user_id: ilinkUserId,
      typing_ticket: typingTicket,
      status: TypingStatus.TYPING,
      base_info: buildBaseInfo(),
    }
    await apiFetch({
      baseUrl: this.baseUrl,
      endpoint: 'ilink/bot/sendtyping',
      body: JSON.stringify(req),
      token: this.token,
      timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
      label: 'sendTyping',
      fetchFn: this.fetchFn,
    })
  }

  // ── getUploadUrl (CDN pre-signed upload) ────────────────────────────────

  async getUploadUrl(params: Omit<GetUploadUrlReq, 'base_info'>): Promise<GetUploadUrlResp> {
    const rawText = await apiFetch({
      baseUrl: this.baseUrl,
      endpoint: 'ilink/bot/getuploadurl',
      body: JSON.stringify({ ...params, base_info: buildBaseInfo() }),
      token: this.token,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      label: 'getUploadUrl',
      fetchFn: this.fetchFn,
    })
    return JSON.parse(rawText) as GetUploadUrlResp
  }

  // ── sendMediaItem (single item per message — iLink protocol requirement) ─

  /**
   * Send a single media item (image, video, file) as one iLink message.
   *
   * The iLink protocol requires exactly one item per `item_list` entry.
   * This method enforces that constraint at the type level by accepting
   * a single `MessageItem` rather than an array.
   *
   * Unlike `sendMessage()` which is text-only, this accepts any pre-built
   * MessageItem (e.g. from `buildImageItem()` after CDN upload).
   */
  async sendMediaItem(
    toUserId: string,
    item: MessageItem,
    contextToken: string,
  ): Promise<void> {
    const msg: WeixinMessage = {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: `opencow-weixin-${crypto.randomUUID()}`,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: [item],
    }
    await apiFetch({
      baseUrl: this.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      body: JSON.stringify({ msg, base_info: buildBaseInfo() } satisfies SendMessageReq),
      token: this.token,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      label: 'sendMediaItem',
      fetchFn: this.fetchFn,
    })
  }

  // ── QR Login (static methods — no auth token needed) ────────────────────

  static async fetchQRCode(
    baseUrl: string = DEFAULT_ILINK_BASE_URL,
    fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ): Promise<QRCodeResponse> {
    const base = ensureTrailingSlash(baseUrl)
    const url = new URL('ilink/bot/get_bot_qrcode?bot_type=3', base)
    log.info(`Fetching QR code from: ${url.toString()}`)

    const response = await fetchFn(url.toString())
    if (!response.ok) {
      const body = await response.text().catch(() => '(unreadable)')
      throw new Error(`Failed to fetch QR code: ${response.status} ${response.statusText} body=${body}`)
    }
    return (await response.json()) as QRCodeResponse
  }

  static async pollQRCodeStatus(
    qrcode: string,
    baseUrl: string = DEFAULT_ILINK_BASE_URL,
    fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ): Promise<QRCodeStatusResponse> {
    const base = ensureTrailingSlash(baseUrl)
    const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS)
    try {
      const response = await fetchFn(url.toString(), {
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable)')
        throw new Error(`QR status poll failed: ${response.status} ${response.statusText} body=${body}`)
      }
      return (await response.json()) as QRCodeStatusResponse
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'wait' }
      }
      throw err
    }
  }
}
