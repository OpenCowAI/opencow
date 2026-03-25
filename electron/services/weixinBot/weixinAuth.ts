// SPDX-License-Identifier: Apache-2.0

/**
 * WeChat QR code login flow — manages the async QR scan lifecycle.
 *
 * Derived from `@tencent-weixin/openclaw-weixin` v1.0.2 (auth/login-qr.ts).
 * Adapted for OpenCow's IPC event model (Main ↔ Renderer communication).
 */

import { WeixinILinkClient, DEFAULT_ILINK_BASE_URL } from './weixinILinkClient'
import type { QRCodeStatusResponse } from './types'
import { createLogger } from '../../platform/logger'

const log = createLogger('WeixinAuth')

const MAX_QR_REFRESH_COUNT = 3

export interface QRCodeLoginResult {
  botToken: string
  baseUrl: string
  accountId: string
  userId?: string
}

export interface WeixinAuthCallbacks {
  onQRCodeReady: (qrcodeUrl: string) => void
  onQRCodeScanned: () => void
  onLoginSuccess: (result: QRCodeLoginResult) => void
  onLoginFailed: (error: string) => void
}

/**
 * Manages a single QR code login attempt.
 *
 * Usage:
 *   const auth = new WeixinAuthSession(callbacks, fetchFn)
 *   await auth.start(baseUrl)  // blocks until login completes or fails
 *   auth.cancel()              // abort from another context (e.g. user clicks Cancel)
 */
export class WeixinAuthSession {
  private abortController: AbortController | null = null

  constructor(
    private readonly callbacks: WeixinAuthCallbacks,
    private readonly fetchFn: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  /**
   * Start the QR login flow. Blocks until confirmed, expired, or cancelled.
   * Automatically refreshes expired QR codes up to MAX_QR_REFRESH_COUNT times.
   */
  async start(baseUrl: string = DEFAULT_ILINK_BASE_URL): Promise<QRCodeLoginResult | null> {
    this.abortController = new AbortController()
    let qrRefreshCount = 0

    try {
      let qrcode = await this.fetchAndEmitQR(baseUrl)
      if (!qrcode) return null

      let scannedNotified = false

      while (!this.abortController.signal.aborted) {
        let statusResp: QRCodeStatusResponse
        try {
          statusResp = await WeixinILinkClient.pollQRCodeStatus(qrcode, baseUrl, this.fetchFn)
        } catch (err) {
          if (this.abortController.signal.aborted) return null
          throw err
        }

        switch (statusResp.status) {
          case 'wait':
            // Still waiting — continue polling
            break

          case 'scaned':
            if (!scannedNotified) {
              scannedNotified = true
              this.callbacks.onQRCodeScanned()
            }
            break

          case 'expired': {
            qrRefreshCount++
            if (qrRefreshCount >= MAX_QR_REFRESH_COUNT) {
              const msg = 'QR code expired too many times. Please try again.'
              log.warn(`Login failed: ${msg}`)
              this.callbacks.onLoginFailed(msg)
              return null
            }
            log.info(`QR code expired, refreshing (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`)
            scannedNotified = false
            qrcode = await this.fetchAndEmitQR(baseUrl)
            if (!qrcode) return null
            break
          }

          case 'confirmed': {
            if (!statusResp.ilink_bot_id || !statusResp.bot_token) {
              const msg = 'Login confirmed but server did not return credentials.'
              log.error(msg)
              this.callbacks.onLoginFailed(msg)
              return null
            }

            const result: QRCodeLoginResult = {
              botToken: statusResp.bot_token,
              baseUrl: statusResp.baseurl ?? baseUrl,
              accountId: statusResp.ilink_bot_id,
              userId: statusResp.ilink_user_id,
            }
            log.info(`Login confirmed! accountId=${statusResp.ilink_bot_id}`)
            this.callbacks.onLoginSuccess(result)
            return result
          }
        }

        // Brief delay before next poll cycle
        await this.sleep(1000)
      }

      return null // aborted
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Login error: ${msg}`)
      this.callbacks.onLoginFailed(msg)
      return null
    }
  }

  /** Cancel an in-progress login attempt. */
  cancel(): void {
    this.abortController?.abort()
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async fetchAndEmitQR(baseUrl: string): Promise<string | null> {
    try {
      const qrResp = await WeixinILinkClient.fetchQRCode(baseUrl, this.fetchFn)
      const imgContent = qrResp.qrcode_img_content
      log.info(`QR image format: prefix="${imgContent?.slice(0, 30)}...", length=${imgContent?.length}`)
      this.callbacks.onQRCodeReady(imgContent)
      return qrResp.qrcode
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.callbacks.onLoginFailed(`Failed to fetch QR code: ${msg}`)
      return null
    }
  }

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
