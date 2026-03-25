// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, QrCode, CheckCircle2, XCircle, Smartphone, AlertTriangle } from 'lucide-react'
import QRCodeLib from 'qrcode'
import type { WeixinConnection, IMConnectionStatus, DataBusEvent } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { TextField } from './fields'
import { GenericConfigPanel } from './GenericConfigPanel'

/**
 * Generate a QR code data URL from the iLink `qrcode_img_content` value.
 *
 * The iLink API returns a **URL** (e.g. `https://liteapp.weixin.qq.com/...`)
 * as `qrcode_img_content`. This URL is the **content** to encode into a QR
 * code — when the user scans it, their WeChat opens this URL to complete
 * the login flow. The official `@tencent-weixin/openclaw-weixin` uses
 * `qrcode-terminal` to render this URL as a terminal QR code.
 *
 * In our Electron renderer, we use the `qrcode` library to generate a
 * data URL image that can be displayed in an `<img>` tag.
 *
 * Fallback: if `qrcode_img_content` is already a data URI or raw base64
 * (future-proofing), we return it directly.
 */
async function generateQRCodeDataUrl(raw: string): Promise<string> {
  // Already a displayable image — use as-is
  if (raw.startsWith('data:image/')) return raw
  // Raw base64 PNG (no URL scheme, doesn't look like a URL)
  if (!raw.includes('://') && !raw.startsWith('http')) {
    return `data:image/png;base64,${raw}`
  }
  // URL content — generate a QR code image from it
  return QRCodeLib.toDataURL(raw, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

// ── QR Login State Machine ──────────────────────────────────────────────────

type QRLoginState =
  | { step: 'idle' }
  | { step: 'loading' }                     // Requesting QR code from server
  | { step: 'waiting'; qrImage: string }     // QR code displayed, waiting for scan
  | { step: 'scanned' }                     // User scanned, waiting for confirmation
  | { step: 'success' }                     // Login succeeded
  | { step: 'failed'; error: string }        // Login failed

// ── QR Code Scan Panel ──────────────────────────────────────────────────────

/**
 * Self-contained QR code scanning component.
 *
 * The QR login flow is driven by DataBus events from the Main process:
 *   1. Renderer calls IPC `messaging:weixin-start-qr-login`
 *   2. Main emits `messaging:weixin-qr-ready` with base64 QR image
 *   3. Main emits `messaging:weixin-qr-scanned` when phone scans
 *   4. Main emits `messaging:weixin-qr-login-success` → Main persists token to Settings
 *   5. `settings:updated` event propagates → ConnectionCard re-renders with hasToken=true
 *
 * This component owns NO token state — persistence is handled entirely by the Main process
 * via `WeixinBotManager.onTokenAcquired` → `settingsService.update()`.
 */
function QRCodeScanPanel({
  connection,
}: {
  connection: WeixinConnection
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<QRLoginState>({ step: 'idle' })

  // Ref tracks current state for the unmount cleanup — avoids the stale closure
  // problem that would occur if `state.step` were in the useEffect deps array.
  const stateRef = useRef(state)
  stateRef.current = state

  // Subscribe to WeChat QR events from Main process
  useEffect(() => {
    const api = getAppAPI()
    const unsub = api['on:opencow:event']((event: DataBusEvent) => {
      switch (event.type) {
        case 'messaging:weixin-qr-ready':
          if (event.payload.connectionId === connection.id) {
            // qrcodeImageContent is a URL — generate QR code image asynchronously
            const rawContent = event.payload.qrcodeImageContent
            generateQRCodeDataUrl(rawContent)
              .then((dataUrl) => setState({ step: 'waiting', qrImage: dataUrl }))
              .catch(() => setState({ step: 'failed', error: 'Failed to generate QR code image' }))
          }
          break
        case 'messaging:weixin-qr-scanned':
          if (event.payload.connectionId === connection.id) {
            setState({ step: 'scanned' })
          }
          break
        case 'messaging:weixin-qr-login-success':
          if (event.payload.connectionId === connection.id) {
            setState({ step: 'success' })
            // Token is persisted by Main process. The `settings:updated` event
            // will trigger a re-render of the parent ConnectionCard, which will
            // see `connection.botToken` populated and show the "authenticated" view.
          }
          break
        case 'messaging:weixin-qr-login-failed':
          if (event.payload.connectionId === connection.id) {
            setState({ step: 'failed', error: event.payload.error })
          }
          break
      }
    })
    return unsub
  }, [connection.id])

  // Cancel QR login on unmount (or when connectionId changes).
  // Reads current state via ref — NOT from the closure — to avoid the stale
  // cleanup problem: React runs the OLD cleanup with the OLD closure values
  // whenever deps change, which would cancel the login on every state transition.
  useEffect(() => {
    return () => {
      const s = stateRef.current.step
      if (s === 'loading' || s === 'waiting' || s === 'scanned') {
        getAppAPI()['messaging:weixin-cancel-qr-login'](connection.id).catch(() => {})
      }
    }
  }, [connection.id])

  const handleStartScan = useCallback(async () => {
    setState({ step: 'loading' })
    try {
      const result = await getAppAPI()['messaging:weixin-start-qr-login'](connection.id)
      if (!result.success) {
        setState({ step: 'failed', error: result.error ?? 'Unknown error' })
      }
      // On success, the QR image will arrive via DataBus event
    } catch (err) {
      setState({ step: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }, [connection.id])

  const handleCancel = useCallback(() => {
    getAppAPI()['messaging:weixin-cancel-qr-login'](connection.id).catch(() => {})
    setState({ step: 'idle' })
  }, [connection.id])

  const handleRetry = useCallback(() => {
    setState({ step: 'idle' })
  }, [])

  const hasToken = !!connection.botToken

  // ── Already authenticated ──────────────────────────────────────────────
  if (hasToken && state.step === 'idle') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-none" />
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('messaging.weixin.loginSuccess')}
          </span>
        </div>
        <button
          type="button"
          onClick={handleStartScan}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline underline-offset-2 transition-colors"
        >
          {t('messaging.weixin.rescan')}
        </button>
      </div>
    )
  }

  // ── QR Code State UI ──────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Gray test warning */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-none mt-0.5" />
        <span className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
          {t('messaging.weixin.grayTestNote')}
        </span>
      </div>

      {state.step === 'idle' && (
        <button
          type="button"
          onClick={handleStartScan}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-[hsl(var(--border))] hover:border-[#07C160] hover:bg-[#07C160]/5 text-sm text-[hsl(var(--muted-foreground))] hover:text-[#07C160] transition-all"
        >
          <QrCode className="h-5 w-5" />
          {t('messaging.weixin.scanToLogin')}
        </button>
      )}

      {state.step === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-8 w-8 animate-spin text-[#07C160]" />
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {t('messaging.weixin.waitingForScan')}
          </span>
        </div>
      )}

      {state.step === 'waiting' && (
        <div className="flex flex-col items-center gap-3">
          <div className="bg-white p-3 rounded-xl border border-[hsl(var(--border))] shadow-sm">
            <img
              src={state.qrImage}
              alt="WeChat QR Code"
              className="w-48 h-48"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
            <Smartphone className="h-4 w-4" />
            {t('messaging.weixin.scanToLogin')}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            {t('messaging.weixin.cancelScan')}
          </button>
        </div>
      )}

      {state.step === 'scanned' && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-8 w-8 animate-spin text-[#07C160]" />
          <span className="text-sm text-[#07C160] font-medium">
            {t('messaging.weixin.scanned')}
          </span>
        </div>
      )}

      {state.step === 'success' && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-none" />
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            {t('messaging.weixin.loginSuccess')}
          </span>
        </div>
      )}

      {state.step === 'failed' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-500 flex-none" />
            <span className="text-sm text-red-600 dark:text-red-400">
              {t('messaging.weixin.loginFailed', { error: state.error })}
            </span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] underline underline-offset-2 transition-colors"
          >
            {t('messaging.weixin.retry')}
          </button>
        </div>
      )}

      {/* Single device warning */}
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        {t('messaging.weixin.singleDeviceWarning')}
      </p>
    </div>
  )
}

// ── Weixin Config Panel ─────────────────────────────────────────────────────

interface WeixinConfigPanelProps {
  connection: WeixinConnection
  status: IMConnectionStatus | null
  onUpdate: (updated: WeixinConnection) => void
}

export function WeixinConfigPanel({
  connection,
  status,
  onUpdate,
}: WeixinConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const isConnected = status?.connectionStatus === 'connected'

  return (
    <GenericConfigPanel
      connection={connection}
      onUpdate={onUpdate}
      afterCredentials={
        <>
          {/* Runtime stats (when connected) */}
          {isConnected && status?.metadata && (
            <div className="flex gap-4 text-xs text-[hsl(var(--muted-foreground))]">
              <span>{t('messaging.weixin.statsReceived', { count: status.metadata.messagesReceived ?? 0 })}</span>
              <span>{t('messaging.weixin.statsSent', { count: status.metadata.messagesSent ?? 0 })}</span>
              {status.connectedAt && (
                <span>{t('messaging.weixin.since', { time: new Date(status.connectedAt).toLocaleTimeString() })}</span>
              )}
            </div>
          )}
        </>
      }
    >
      {(patch) => (
        <>
          {/* QR Code Scan Panel — primary authentication method */}
          <QRCodeScanPanel connection={connection} />

          {/* Optional: iLink server URL override */}
          <TextField
            label={t('messaging.weixin.baseUrl')}
            value={connection.baseUrl || ''}
            placeholder="https://ilinkai.weixin.qq.com"
            onChange={(v) => patch({ baseUrl: v || undefined })}
          />
        </>
      )}
    </GenericConfigPanel>
  )
}
