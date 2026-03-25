// SPDX-License-Identifier: Apache-2.0

/**
 * WeChat CDN upload pipeline — encrypts and uploads media files for sending.
 *
 * Mirrors `@tencent-weixin/openclaw-weixin` v1.0.3 (cdn/upload.ts + cdn/aes-ecb.ts + cdn/cdn-upload.ts).
 *
 * Flow:
 *   1. Read file → compute MD5 + size
 *   2. Generate random AES-128-ECB key
 *   3. Call `getUploadUrl` API to get a pre-signed CDN upload URL
 *   4. AES-128-ECB encrypt the file
 *   5. POST ciphertext to CDN → get `x-encrypted-param` response header
 *   6. Return UploadedFileInfo for constructing the sendMessage payload
 */

import crypto from 'node:crypto'

import type { UploadedFileInfo, GetUploadUrlResp } from './types'
import { UploadMediaType } from './types'
import type { WeixinILinkClient } from './weixinILinkClient'
import { createLogger } from '../../platform/logger'

const log = createLogger('WeixinCDN')

const UPLOAD_MAX_RETRIES = 3

// ── Default CDN base URL ────────────────────────────────────────────────────

/**
 * Default CDN base URL for file upload/download.
 *
 * Note: This is the public CDN endpoint, distinct from the iLink API base URL.
 * May be overridden per-account if the server returns a custom `cdnBaseUrl`.
 */
const DEFAULT_CDN_BASE_URL = 'https://cdn.ilinkai.weixin.qq.com'

// ── AES-128-ECB helpers ─────────────────────────────────────────────────────

/** Encrypt buffer with AES-128-ECB (PKCS7 padding is default in Node.js crypto). */
function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16
}

// ── CDN URL construction ────────────────────────────────────────────────────

function buildCdnUploadUrl(params: {
  cdnBaseUrl: string
  uploadParam: string
  filekey: string
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`
}

// ── CDN upload (binary POST) ────────────────────────────────────────────────

/**
 * Upload one encrypted buffer to the Weixin CDN.
 * Returns the download encrypted_query_param from the CDN `x-encrypted-param` response header.
 * Retries up to UPLOAD_MAX_RETRIES times on server errors; client errors (4xx) abort immediately.
 */
async function uploadBufferToCdn(params: {
  buf: Buffer
  uploadParam: string
  filekey: string
  cdnBaseUrl: string
  aeskey: Buffer
  label: string
  fetchFn: typeof globalThis.fetch
}): Promise<{ downloadParam: string }> {
  const { buf, uploadParam, filekey, cdnBaseUrl, aeskey, label, fetchFn } = params
  const ciphertext = encryptAesEcb(buf, aeskey)
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey })
  log.debug(`${label}: CDN POST ciphertextSize=${ciphertext.length}`)

  let downloadParam: string | undefined
  let lastError: unknown

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchFn(cdnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      })
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get('x-error-message') ?? (await res.text())
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`)
      }
      if (res.status !== 200) {
        const errMsg = res.headers.get('x-error-message') ?? `status ${res.status}`
        throw new Error(`CDN upload server error: ${errMsg}`)
      }
      downloadParam = res.headers.get('x-encrypted-param') ?? undefined
      if (!downloadParam) {
        throw new Error('CDN upload response missing x-encrypted-param header')
      }
      log.debug(`${label}: CDN upload success attempt=${attempt}`)
      break
    } catch (err) {
      lastError = err
      if (err instanceof Error && err.message.includes('client error')) throw err
      if (attempt < UPLOAD_MAX_RETRIES) {
        log.error(`${label}: attempt ${attempt} failed, retrying... err=${String(err)}`)
      } else {
        log.error(`${label}: all ${UPLOAD_MAX_RETRIES} attempts failed err=${String(err)}`)
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`)
  }
  return { downloadParam }
}

// ── High-level upload API ───────────────────────────────────────────────────

/**
 * Upload a raw buffer (image/video/file) to the Weixin CDN.
 *
 * This is the primary entry point for media sending. It:
 *   1. Computes MD5 + sizes
 *   2. Generates a random AES key + filekey
 *   3. Calls `getUploadUrl` on the iLink API
 *   4. Encrypts and uploads to CDN
 *   5. Returns the info needed to construct a sendMessage payload
 */
export async function uploadMediaBuffer(params: {
  buffer: Buffer
  toUserId: string
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType]
  client: WeixinILinkClient
  cdnBaseUrl?: string
  fetchFn?: typeof globalThis.fetch
}): Promise<UploadedFileInfo> {
  const {
    buffer,
    toUserId,
    mediaType,
    client,
    cdnBaseUrl = DEFAULT_CDN_BASE_URL,
    fetchFn = globalThis.fetch,
  } = params

  const rawsize = buffer.length
  const rawfilemd5 = crypto.createHash('md5').update(buffer).digest('hex')
  const filesize = aesEcbPaddedSize(rawsize)
  const filekey = crypto.randomBytes(16).toString('hex')
  const aeskey = crypto.randomBytes(16)

  log.debug(`uploadMediaBuffer: rawsize=${rawsize} filesize=${filesize} md5=${rawfilemd5} filekey=${filekey}`)

  // Step 1: Get pre-signed CDN upload URL from iLink API
  const uploadUrlResp: GetUploadUrlResp = await client.getUploadUrl({
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString('hex'),
  })

  const uploadParam = uploadUrlResp.upload_param
  if (!uploadParam) {
    throw new Error('getUploadUrl returned no upload_param')
  }

  // Step 2: Encrypt and upload to CDN
  const { downloadParam } = await uploadBufferToCdn({
    buf: buffer,
    uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
    label: `uploadMedia[type=${mediaType}]`,
    fetchFn,
  })

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString('hex'),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  }
}
