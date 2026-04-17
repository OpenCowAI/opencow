// SPDX-License-Identifier: Apache-2.0

/**
 * Subscription Auth Provider — Claude Pro/Max/Team/Enterprise OAuth 2.0 PKCE.
 *
 * Post-consolidation (plans/anthropic-auth-consolidation.md): the OAuth
 * wire protocol (PKCE crypto, authorise-URL construction, local callback
 * listener, token exchange, token refresh) is delegated to
 * `@opencow-ai/opencow-agent-sdk`. This file owns only the bits that are
 * NOT part of the OAuth spec and that the CLI-targeted SDK helpers don't
 * cover cleanly:
 *
 *   1. Multi-profile credential storage (`CredentialStore`, keyed by
 *      `credential:${profile.id}`) — the SDK assumes a single global
 *      secure-storage slot for CLI use; OpenCow runs N profiles per
 *      machine, so we persist tokens ourselves.
 *   2. ProviderAdapter interface — probe / getEnv / getHTTPAuth contract
 *      shared across all providers in OpenCow.
 *   3. Cancellation semantics — the IPC flow can be cancelled by the user
 *      mid-OAuth (close-dialog button); we thread an `AbortController`
 *      through and race it against the SDK's listener promise.
 *   4. Custom branded success page — the SDK's default redirect sends the
 *      browser to `claude.ai/oauth/code/success`; we override with a
 *      response handler to show OpenCow branding.
 *
 * Token lifecycle:
 *   - Access token: ~8 hours, proactively refreshed when within 5 min of expiry
 *   - Refresh token: long-lived, preserved across refreshes (server may omit it)
 */

import { net, shell } from 'electron'
import {
  AuthCodeListener,
  buildAuthUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getOauthConfig,
  isOAuthTokenExpired,
  parseScopes,
} from '@opencow-ai/opencow-agent-sdk'
import type { ServerResponse } from 'http'
import type { HTTPAuthResult, OAuthCredential, ProbeResult, ProviderAdapter, ProviderAdapterStatus } from '../types'
import { OAUTH_FLOW_TIMINGS } from '../types'
import { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

/**
 * HTTP-client boundary: the SDK's `exchangeCodeForTokens` and
 * `refreshOAuthToken` use axios, which Cloudflare flags via TLS
 * fingerprinting on Anthropic's OAuth token endpoint (403). We
 * re-implement just those two HTTP calls using Electron's `net.fetch`
 * (Chromium network stack) to bypass the detection.
 *
 * Everything OAuth-spec-related (PKCE, authorise-URL build, local
 * callback listener, scopes, config) still comes from the SDK — so
 * protocol updates propagate from one place.
 *
 * Follow-up: push an SDK patch that accepts a `fetchFn` injectable
 * on both helpers, then migrate the two methods below back to the
 * SDK. Tracked in plans/anthropic-auth-consolidation.md §9.
 */

const log = createLogger('Auth:Subscription')

/**
 * Parse + validate a token-endpoint response into an `OAuthCredential`.
 *
 * The response body is an opaque JSON blob — every field is
 * runtime-checked before we construct the typed credential so malformed
 * or adversarial payloads can't bypass the type system. Subscription
 * metadata is optional (Anthropic-specific extension).
 *
 * When refreshing, the server may omit `refresh_token` — callers pass
 * `fallbackRefreshToken` so the existing refresh token survives.
 */
function parseTokenResponse(
  raw: Record<string, unknown>,
  options?: { fallbackRefreshToken?: string },
): OAuthCredential {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : ''
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : ''
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 0
  const scope = typeof raw.scope === 'string' ? raw.scope : undefined

  if (!accessToken) {
    throw new Error('OAuth token response missing access_token')
  }

  return {
    accessToken,
    refreshToken: refreshToken || options?.fallbackRefreshToken || '',
    expiresAt: Date.now() + expiresIn * 1000,
    // `scopes` is required on OAuthCredential — fall back to empty
    // array when the server omits `scope` (rare but legal per §4.1.4).
    scopes: scope ? scope.split(' ').filter(Boolean) : [],
    subscriptionType:
      typeof raw.subscription_type === 'string' ? raw.subscription_type : undefined,
    rateLimitTier:
      typeof raw.rate_limit_tier === 'string' ? raw.rate_limit_tier : undefined,
  }
}

export class SubscriptionProvider implements ProviderAdapter {
  private readonly store: CredentialStore
  private readonly credentialKey: string
  /** Guard against concurrent login attempts. */
  private loginInProgress = false
  /** AbortController for the current OAuth flow — enables cancellation. */
  private flowAbort: AbortController | null = null

  constructor(store: CredentialStore, credentialKey: string = 'subscription') {
    this.store = store
    this.credentialKey = credentialKey
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const credential = await this.store.getAs<OAuthCredential>(this.credentialKey)
    if (!credential) {
      return { authenticated: false }
    }

    if (isOAuthTokenExpired(credential.expiresAt)) {
      try {
        await this.refreshAndPersist(credential)
        const refreshed = await this.store.getAs<OAuthCredential>(this.credentialKey)
        return {
          authenticated: true,
          detail: { subscriptionType: refreshed?.subscriptionType },
        }
      } catch (err) {
        log.warn('Token refresh failed during status check', err)
        return { authenticated: false, error: 'Token expired and refresh failed' }
      }
    }

    return {
      authenticated: true,
      detail: { subscriptionType: credential.subscriptionType },
    }
  }

  async getEnv(): Promise<Record<string, string>> {
    const token = await this.resolveAccessToken()
    if (!token) {
      log.warn('getEnv: no subscription credential or missing accessToken')
      return {}
    }
    return { CLAUDE_CODE_OAUTH_TOKEN: token }
  }

  async getHTTPAuth(): Promise<HTTPAuthResult | null> {
    const token = await this.resolveAccessToken()
    if (!token) return null
    return {
      apiKey: token,
      baseUrl: 'https://api.anthropic.com',
      authStyle: 'bearer',
    }
  }

  async authenticate(): Promise<ProviderAdapterStatus> {
    if (this.loginInProgress) {
      return { authenticated: false, error: 'Login already in progress' }
    }

    this.loginInProgress = true
    this.flowAbort = new AbortController()
    try {
      const credential = await this.performOAuthFlow(this.flowAbort.signal)

      if (!credential.accessToken) {
        log.error('OAuth flow returned credential without accessToken')
        return { authenticated: false, error: 'OAuth completed but no access token received' }
      }

      await this.store.updateAs(this.credentialKey, credential)
      log.info('OAuth credential stored successfully', {
        hasRefreshToken: !!credential.refreshToken,
        expiresAt: new Date(credential.expiresAt).toISOString(),
        subscriptionType: credential.subscriptionType ?? 'unknown',
      })

      return {
        authenticated: true,
        detail: { subscriptionType: credential.subscriptionType },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (this.flowAbort?.signal.aborted) {
        log.info('OAuth flow cancelled by user')
        return { authenticated: false, error: 'Login cancelled' }
      }
      log.error('OAuth flow failed', err)
      return { authenticated: false, error: message }
    } finally {
      this.flowAbort = null
      this.loginInProgress = false
    }
  }

  async cancelLogin(): Promise<void> {
    if (!this.flowAbort) return
    log.info('Cancelling OAuth flow')
    this.flowAbort.abort()
  }

  async logout(): Promise<void> {
    await this.store.removeAt(this.credentialKey)
    log.info('Subscription credentials cleared')
  }

  async probe(): Promise<ProbeResult> {
    const status = await this.checkStatus()
    if (status.authenticated) {
      return { ok: true, detail: status.detail?.subscriptionType }
    }
    return {
      ok: false,
      reason: 'unauthenticated',
      message: status.error ?? 'Subscription credentials missing or expired',
    }
  }

  // ── Private: Token Resolution ──────────────────────────────────────

  /**
   * Resolve a valid access token, performing proactive refresh if needed.
   *
   * Shared by `getEnv()` (SDK subprocess env vars) and `getHTTPAuth()`
   * (direct HTTP calls).
   *
   * Note: `checkStatus()` has stricter error semantics (returns
   * `authenticated: false` on refresh failure) so does NOT share this.
   */
  private async resolveAccessToken(): Promise<string | null> {
    const credential = await this.store.getAs<OAuthCredential>(this.credentialKey)
    if (!credential?.accessToken) return null

    if (isOAuthTokenExpired(credential.expiresAt)) {
      try {
        await this.refreshAndPersist(credential)
        const refreshed = await this.store.getAs<OAuthCredential>(this.credentialKey)
        if (refreshed?.accessToken) return refreshed.accessToken
        log.warn('Token refresh completed but accessToken still missing')
      } catch (err) {
        log.warn('Proactive token refresh failed — using existing (possibly expired) token', err)
      }
    }

    return credential.accessToken
  }

  // ── Private: OAuth PKCE Flow ────────────────────────────────────────

  private async performOAuthFlow(signal: AbortSignal): Promise<OAuthCredential> {
    // 1. PKCE verifier + S256 challenge + independent CSRF state.
    //    `verifier` is used only in the token exchange (never in URLs);
    //    `state` is echoed by the authorisation server back to our
    //    callback and MUST match to prevent code-injection attacks.
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    const state = generateState()

    // 2. Start the local callback listener. SDK binds to IPv6 `::` with
    //    dual-stack, so browsers resolving `localhost` to either `::1`
    //    or `127.0.0.1` both reach the server.
    const listener = new AuthCodeListener()
    const port = await listener.start()
    const redirectUri = `http://localhost:${port}/callback`

    // 3. Build the authorise URL. `loginWithClaudeAi: true` routes to
    //    `claude.com/cai/oauth/authorize` (the consumer subscription
    //    flow), which 307-redirects to `claude.ai/oauth/authorize`.
    const authUrl = buildAuthUrl({
      codeChallenge: challenge,
      state,
      port,
      isManual: false,
      loginWithClaudeAi: true,
    })

    // If abort fires while listener is waiting, close it — that triggers
    // rejection in `listener.waitForAuthorization` so the await unblocks.
    const onAbort = () => {
      log.info('Abort fired during OAuth flow; closing listener')
      listener.close()
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      log.info('OAuth flow started', { port, redirectUri })

      // 4. Race: (a) listener resolves with code, (b) user aborts, (c) timeout.
      const codePromise = listener.waitForAuthorization(state, async () => {
        await shell.openExternal(authUrl)
      })
      const code = await this.withAbortableTimeout(
        codePromise,
        OAUTH_FLOW_TIMINGS.flowTimeoutMs,
        `OAuth flow timed out — browser callback not received on ${redirectUri}`,
        signal,
      )

      log.info('OAuth callback received, exchanging code for tokens...')

      // 5. Exchange code for tokens via Chromium network stack (see note
      //    at top of file — axios+TLS-fingerprint triggers Cloudflare 403).
      const tokenResponse = await this.exchangeCodeForTokensViaNetFetch({
        code,
        state,
        verifier,
        redirectUri,
      })

      // 6. Serve the custom OpenCow-branded success page to the browser
      //    (overrides SDK's default 302 → claude.ai success URL).
      const scopes = parseScopes(tokenResponse.scope)
      listener.handleSuccessRedirect(scopes, (res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(this.buildResultPage(true, 'Your Claude subscription has been connected to OpenCow.'))
      })

      // 7. Assemble the persisted credential. The token-exchange response
      //    doesn't include subscription_type / rate_limit_tier — those
      //    come from `/api/oauth/profile`. Skipping that optional RTT
      //    here keeps the login path quick; `checkStatus()` or the first
      //    refresh backfills those fields when the SDK exposes a
      //    Cloudflare-safe profile fetcher (follow-up, see top-of-file).
      return {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
        scopes,
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      listener.close()
      log.info('Callback server closed')
    }
  }

  // ── Private: Token Refresh ──────────────────────────────────────────

  /**
   * Refresh the access token via the Chromium network stack (see
   * top-of-file note), then persist to the profile-scoped store.
   *
   * Server may omit `refresh_token` on refresh (access-token rotation
   * only); we fall back to the existing one so the next expiry isn't
   * terminal. Subscription metadata likewise falls through when the
   * response omits it.
   */
  private async refreshAndPersist(credential: OAuthCredential): Promise<void> {
    log.info('Refreshing OAuth access token')

    const response = await net.fetch(getOauthConfig().TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: getOauthConfig().CLIENT_ID,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${body}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const parsed = parseTokenResponse(data, {
      fallbackRefreshToken: credential.refreshToken,
    })

    await this.store.updateAs<OAuthCredential>(this.credentialKey, {
      ...parsed,
      subscriptionType: parsed.subscriptionType ?? credential.subscriptionType,
      rateLimitTier: parsed.rateLimitTier ?? credential.rateLimitTier,
    })
    log.info('Token refreshed successfully')
  }

  // ── Private: Token Exchange ─────────────────────────────────────────

  /**
   * POST the authorization code to Anthropic's token endpoint via
   * Electron's `net.fetch`. Body shape mirrors `OAuth 2.0 RFC 6749 §4.1.3`
   * plus Anthropic's extension: `state` is echoed so the server can
   * correlate with the authorise step.
   */
  private async exchangeCodeForTokensViaNetFetch(params: {
    code: string
    state: string
    verifier: string
    redirectUri: string
  }): Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
    scope?: string
  }> {
    const { code, state, verifier, redirectUri } = params
    const response = await net.fetch(getOauthConfig().TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        grant_type: 'authorization_code',
        client_id: getOauthConfig().CLIENT_ID,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        state,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      log.error(`Token exchange failed (${response.status}): ${body}`)
      throw new Error(`Token exchange failed (${response.status}): ${body}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    log.info('Token exchange successful', {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    })

    const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 0
    const scope = typeof data.scope === 'string' ? data.scope : undefined

    if (!accessToken) {
      throw new Error('OAuth token response missing access_token')
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      scope,
    }
  }

  // ── Private: Helpers ────────────────────────────────────────────────

  private withAbortableTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutMessage: string,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)

      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('Login cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })

      promise
        .then((value) => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        })
        .catch((err) => {
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          reject(err)
        })
    })
  }

  private buildResultPage(success: boolean, message: string): string {
    const title = success ? 'OpenCow — Authentication Successful' : 'OpenCow — Authentication Failed'
    const iconSvg = success
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" opacity="0.2"/><path class="check" d="M8 12.5l2.5 2.5 5.5-5.5"/></svg>'
      : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" opacity="0.2"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
    const iconBg = success ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'
    const iconColor = success ? '#10b981' : '#ef4444'

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;background:#f8f8f8;color:#1a1a1a;
      -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
    }
    body::before{
      content:'';position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      width:700px;height:700px;pointer-events:none;z-index:0;
      background:radial-gradient(circle,rgba(99,102,241,0.04) 0%,transparent 70%);
    }
    .container{
      position:relative;z-index:1;text-align:center;
      padding:3.5rem 4rem;max-width:420px;
      border:1px solid rgba(0,0,0,0.06);border-radius:16px;background:#fff;
      box-shadow:0 1px 2px rgba(0,0,0,0.03),0 4px 16px rgba(0,0,0,0.04);
      animation:fadeInUp .6s cubic-bezier(.16,1,.3,1) both;
    }
    @keyframes fadeInUp{
      from{opacity:0;transform:translateY(12px)}
      to{opacity:1;transform:translateY(0)}
    }
    .icon-wrapper{
      display:inline-flex;align-items:center;justify-content:center;
      width:56px;height:56px;border-radius:50%;
      background:${iconBg};margin-bottom:1.5rem;
      animation:scaleIn .5s cubic-bezier(.16,1,.3,1) .15s both;
    }
    @keyframes scaleIn{
      from{opacity:0;transform:scale(.5)}
      to{opacity:1;transform:scale(1)}
    }
    .icon-wrapper svg{
      width:28px;height:28px;stroke:${iconColor};stroke-width:2;
      fill:none;stroke-linecap:round;stroke-linejoin:round;
    }
    .icon-wrapper svg .check{
      stroke-dasharray:24;stroke-dashoffset:24;
      animation:drawCheck .4s ease .5s forwards;
    }
    @keyframes drawCheck{to{stroke-dashoffset:0}}
    .title{
      font-size:1.125rem;font-weight:600;letter-spacing:-0.01em;color:#111;
      margin-bottom:.5rem;
      animation:fadeInUp .6s cubic-bezier(.16,1,.3,1) .2s both;
    }
    .message{
      font-size:.875rem;line-height:1.5;color:rgba(0,0,0,0.45);
      animation:fadeInUp .6s cubic-bezier(.16,1,.3,1) .3s both;
    }
    .divider{
      width:32px;height:1px;background:rgba(0,0,0,0.08);margin:1.5rem auto;
      animation:fadeInUp .6s cubic-bezier(.16,1,.3,1) .35s both;
    }
    .hint{
      font-size:.8125rem;color:rgba(0,0,0,0.25);
      animation:fadeInUp .6s cubic-bezier(.16,1,.3,1) .4s both;
    }
    .hint kbd{
      display:inline-block;padding:1px 6px;font-family:inherit;font-size:.75rem;
      border:1px solid rgba(0,0,0,0.1);border-radius:4px;
      background:rgba(0,0,0,0.03);color:rgba(0,0,0,0.35);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon-wrapper">${iconSvg}</div>
    <div class="title">${success ? 'Authentication successful' : 'Authentication failed'}</div>
    <div class="message">${message}</div>
    <div class="divider"></div>
    <div class="hint">You can close this tab or press <kbd>⌘</kbd> + <kbd>W</kbd></div>
  </div>
</body>
</html>`
  }
}
