// SPDX-License-Identifier: Apache-2.0

/**
 * WeChat iLink protocol types — mirrors the Tencent iLink bot API.
 *
 * Derived from `@tencent-weixin/openclaw-weixin` v1.0.2 (api/types.ts).
 * Protocol: JSON over HTTPS, base URL `https://ilinkai.weixin.qq.com`.
 */

import type { IMConnectionStatusType, UserConfigurableWorkspaceInput } from '../../../src/shared/types'

// ── Common ───────────────────────────────────────────────────────────────────

/** Metadata attached to every outgoing API request. */
export interface ILinkBaseInfo {
  channel_version?: string
}

// ── Message item types ───────────────────────────────────────────────────────

export const MessageType = {
  NONE: 0,
  /** Inbound: user → bot */
  USER: 1,
  /** Outbound: bot → user */
  BOT: 2,
} as const

export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

export interface TextItem {
  text?: string
}

/**
 * CDN media reference for encrypted file download.
 *
 * Encoding: `aes_key` = `base64(hexString)` where hexString is the
 * hex-encoded AES-128-ECB key. The recipient decodes via:
 *   base64 → hex string → hexDecode → 16-byte AES key.
 */
export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
  encrypt_type?: number
}

export interface ImageItem {
  media?: CDNMedia
  thumb_media?: CDNMedia
  aeskey?: string
  url?: string
  /** Ciphertext size of the mid-resolution image (fill with fileSizeCiphertext on send). */
  mid_size?: number
}

export interface VoiceItem {
  media?: CDNMedia
  encode_type?: number
  playtime?: number
  /** Voice-to-text transcription from WeChat. */
  text?: string
}

export interface FileItem {
  media?: CDNMedia
  file_name?: string
  md5?: string
  len?: string
}

export interface VideoItem {
  media?: CDNMedia
  video_size?: number
  play_length?: number
  thumb_media?: CDNMedia
}

export interface RefMessage {
  message_item?: MessageItem
  title?: string
}

export interface MessageItem {
  type?: number
  create_time_ms?: number
  update_time_ms?: number
  is_completed?: boolean
  msg_id?: string
  ref_msg?: RefMessage
  text_item?: TextItem
  image_item?: ImageItem
  voice_item?: VoiceItem
  file_item?: FileItem
  video_item?: VideoItem
}

/** Unified iLink message (proto: WeixinMessage). */
export interface WeixinMessage {
  seq?: number
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  create_time_ms?: number
  update_time_ms?: number
  session_id?: string
  group_id?: string
  message_type?: number
  message_state?: number
  item_list?: MessageItem[]
  context_token?: string
}

// ── getUpdates ───────────────────────────────────────────────────────────────

export interface GetUpdatesReq {
  get_updates_buf?: string
  base_info?: ILinkBaseInfo
}

export interface GetUpdatesResp {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

// ── sendMessage ──────────────────────────────────────────────────────────────

export interface SendMessageReq {
  msg?: WeixinMessage
  base_info?: ILinkBaseInfo
}

// ── CDN Upload ──────────────────────────────────────────────────────────────

export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const

export interface GetUploadUrlReq {
  filekey?: string
  media_type?: number
  to_user_id?: string
  rawsize?: number
  rawfilemd5?: string
  filesize?: number
  thumb_rawsize?: number
  thumb_rawfilemd5?: string
  thumb_filesize?: number
  no_need_thumb?: boolean
  aeskey?: string
  base_info?: ILinkBaseInfo
}

export interface GetUploadUrlResp {
  upload_param?: string
  thumb_upload_param?: string
}

/** Info returned after a successful CDN upload. */
export interface UploadedFileInfo {
  filekey: string
  /** CDN download encrypted_query_param — fill into CDNMedia.encrypt_query_param */
  downloadEncryptedQueryParam: string
  /**
   * AES-128-ECB key, hex-encoded (32-char string).
   * For CDNMedia.aes_key, encode as `Buffer.from(aeskey).toString('base64')`
   * (base64 of the hex string, NOT base64 of the raw key bytes).
   */
  aeskey: string
  /** Plaintext file size in bytes */
  fileSize: number
  /** Ciphertext file size in bytes (AES-128-ECB with PKCS7 padding) */
  fileSizeCiphertext: number
}

// ── sendTyping ───────────────────────────────────────────────────────────────

export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const

export interface SendTypingReq {
  ilink_user_id?: string
  typing_ticket?: string
  status?: number
  base_info?: ILinkBaseInfo
}

// ── getConfig ────────────────────────────────────────────────────────────────

export interface GetConfigResp {
  ret?: number
  errmsg?: string
  typing_ticket?: string
}

// ── QR Login ─────────────────────────────────────────────────────────────────

export interface QRCodeResponse {
  qrcode: string
  qrcode_img_content: string
}

export type QRCodeStatus = 'wait' | 'scaned' | 'confirmed' | 'expired'

export interface QRCodeStatusResponse {
  status: QRCodeStatus
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
}

// ── Internal service types ───────────────────────────────────────────────────

/** Internal configuration for a single WeChat Bot instance (parallels TelegramBotEntry). */
export interface WeixinBotEntry {
  id: string
  name: string
  enabled: boolean
  botToken: string
  baseUrl?: string
  allowedUserIds: string[]
  defaultWorkspace: UserConfigurableWorkspaceInput
}

/** Runtime status for a WeChat Bot instance (parallels TelegramBotStatus). */
export interface WeixinBotStatus {
  connectionId: string
  connectionStatus: IMConnectionStatusType
  connectedAt: number | null
  lastError: string | null
  messagesReceived: number
  messagesSent: number
}

/** Error code returned by iLink when bot session has expired. */
export const SESSION_EXPIRED_ERRCODE = -14
