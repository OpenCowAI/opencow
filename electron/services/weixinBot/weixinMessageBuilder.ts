// SPDX-License-Identifier: Apache-2.0

/**
 * Weixin iLink message item builders.
 *
 * Encapsulates all protocol-level encoding rules for media MessageItems
 * (aes_key format, encrypt_type, size fields) so that callers never need
 * to know iLink protocol details.
 *
 * Mirrors the builder pattern in the official SDK (`messaging/send.ts`):
 *   buildImageItem  → sendImageMessageWeixin
 *   buildVideoItem  → sendVideoMessageWeixin
 *   buildFileItem   → sendFileMessageWeixin
 */

import type { MessageItem, UploadedFileInfo, CDNMedia } from './types'
import { MessageItemType } from './types'

// ── CDN media encoding ──────────────────────────────────────────────────────

/**
 * Build the CDNMedia reference from an uploaded file.
 *
 * Encoding contract (matching official SDK `messaging/send.ts`):
 *   - `encrypt_query_param`: opaque string from CDN `x-encrypted-param` header
 *   - `aes_key`: the hex-encoded AES key, re-encoded as base64
 *     i.e. `base64(utf8Bytes(hexString))`, NOT `base64(rawKeyBytes)`
 *   - `encrypt_type`: always `1` (AES-128-ECB)
 *
 * Why `Buffer.from(hex).toString('base64')` instead of `Buffer.from(hex, 'hex').toString('base64')`?
 * The iLink protocol expects `aes_key = base64(hexString)`. The recipient decodes:
 *   base64 → hex string → hexDecode → 16-byte AES key.
 * Using `'hex'` encoding would produce `base64(16 raw bytes)` — a shorter,
 * semantically different value that the WeChat client cannot decode.
 */
function buildCdnMedia(uploaded: UploadedFileInfo): CDNMedia {
  return {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskey).toString('base64'),
    encrypt_type: 1,
  }
}

// ── Public builders ─────────────────────────────────────────────────────────

/**
 * Build an IMAGE MessageItem from a CDN-uploaded image.
 *
 * Sets `mid_size` to the ciphertext size (matches official SDK `ImageItem.mid_size`).
 */
export function buildImageItem(uploaded: UploadedFileInfo): MessageItem {
  return {
    type: MessageItemType.IMAGE,
    image_item: {
      media: buildCdnMedia(uploaded),
      mid_size: uploaded.fileSizeCiphertext,
    },
  }
}

/**
 * Build a VIDEO MessageItem from a CDN-uploaded video.
 *
 * Sets `video_size` to the ciphertext size (matches official SDK `VideoItem.video_size`).
 */
export function buildVideoItem(uploaded: UploadedFileInfo): MessageItem {
  return {
    type: MessageItemType.VIDEO,
    video_item: {
      media: buildCdnMedia(uploaded),
      video_size: uploaded.fileSizeCiphertext,
    },
  }
}

/**
 * Build a FILE MessageItem from a CDN-uploaded file attachment.
 *
 * Sets `file_name` and `len` (plaintext size as string, matching official SDK).
 */
export function buildFileItem(uploaded: UploadedFileInfo, fileName: string): MessageItem {
  return {
    type: MessageItemType.FILE,
    file_item: {
      media: buildCdnMedia(uploaded),
      file_name: fileName,
      len: String(uploaded.fileSize),
    },
  }
}
