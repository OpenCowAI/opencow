// SPDX-License-Identifier: Apache-2.0

/**
 * Subscription Auth Provider — OAuth 2.0 PKCE flow for Claude Pro/Max/Team/Enterprise.
 *
 * Implements the same OAuth flow as `claude auth login`:
 *   1. Generate PKCE verifier + S256 challenge
 *   2. Start a local HTTP callback server on a random port
 *   3. Open the system browser to claude.com/cai/oauth/authorize
 *   4. Receive the authorization code via localhost redirect
 *   5. Exchange the code for access + refresh tokens
 *   6. Store tokens in CredentialStore
 *
 * Token lifecycle:
 *   - Access token: ~8 hours, auto-refreshed before expiry
 *   - Refresh token: long-lived
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { createHash, randomBytes } from 'crypto'
import { net, shell } from 'electron'
import type { HTTPAuthResult, ProviderAdapter, ProviderAdapterStatus, OAuthCredential } from '../types'
import { OAUTH_CONFIG } from '../types'
import { CredentialStore } from '../credentialStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Auth:Subscription')

export class SubscriptionProvider implements ProviderAdapter {
  private readonly store: CredentialStore
  /** Guard against concurrent login attempts. */
  private loginInProgress = false
  /** AbortController for the current OAuth flow — enables cancellation. */
  private flowAbort: AbortController | null = null

  constructor(store: CredentialStore) {
    this.store = store
  }

  async checkStatus(): Promise<ProviderAdapterStatus> {
    const credential = await this.store.get('subscription')
    if (!credential) {
      return { authenticated: false }
    }

    // Check if access token is expired (with buffer)
    if (this.isTokenExpired(credential)) {
      try {
        await this.refreshToken(credential)
        const refreshed = await this.store.get('subscription')
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

      // Validate the credential before persisting — catch malformed responses early
      if (!credential.accessToken) {
        log.error('OAuth flow returned credential without accessToken')
        return { authenticated: false, error: 'OAuth completed but no access token received' }
      }

      await this.store.update('subscription', credential)
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
    await this.store.remove('subscription')
    log.info('Subscription credentials cleared')
  }

  // ── Private: Token Resolution ──────────────────────────────────────

  /**
   * Resolve a valid access token, performing proactive refresh if needed.
   *
   * Shared by `getEnv()` (SDK subprocess env vars) and `getHTTPAuth()`
   * (direct HTTP calls) to ensure consistent token refresh behavior.
   *
   * Note: `checkStatus()` has its own refresh logic with stricter error
   * semantics (returns unauthenticated on refresh failure), so it does
   * NOT share this method.
   */
  private async resolveAccessToken(): Promise<string | null> {
    const credential = await this.store.get('subscription')
    if (!credential?.accessToken) return null

    if (this.isTokenExpired(credential)) {
      try {
        await this.refreshToken(credential)
        const refreshed = await this.store.get('subscription')
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
    // Step 1: Generate PKCE parameters and a separate CSRF state token.
    // IMPORTANT: verifier and state serve different security purposes and MUST be independent:
    //   - verifier: PKCE proof (only used in token exchange, never exposed in URLs)
    //   - state: CSRF protection (echoed in callback URL, verified to prevent forgery)
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(16).toString('base64url')

    // Step 2: Start local callback server
    const { server, port, codePromise } = await this.createCallbackServer(signal)
    const redirectUri = this.buildRedirectUri(port)

    try {
      // Step 3: Open browser for authorization
      const authUrl = this.buildAuthUrl(port, challenge, state)
      log.info('OAuth flow started', { port, redirectUri })
      await shell.openExternal(authUrl)

      // Step 4: Wait for callback with authorization code (respects abort)
      log.info('Waiting for browser callback...')
      const callback = await this.withAbortableTimeout(
        codePromise,
        OAUTH_CONFIG.flowTimeoutMs,
        `OAuth flow timed out — browser callback not received on ${redirectUri}`,
        signal
      )
      log.info('OAuth callback received, verifying state...')

      // Verify CSRF state matches to prevent authorization code injection attacks
      if (callback.state !== state) {
        throw new Error('OAuth state mismatch — possible CSRF attack')
      }

      // Step 5: Exchange code for tokens
      log.info('CSRF state verified, exchanging code for tokens...')
      return await this.exchangeCodeForTokens({
        code: callback.code,
        verifier,
        port,
        state: callback.state,
      })
    } finally {
      server.close()
      log.info('Callback server closed')
    }
  }

  private async createCallbackServer(signal: AbortSignal): Promise<{
    server: Server
    port: number
    codePromise: Promise<{ code: string; state: string }>
  }> {
    let resolveCode: (value: { code: string; state: string }) => void
    let rejectCode: (reason: Error) => void

    const codePromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
      resolveCode = resolve
      rejectCode = reject
    })

    // If abort fires before callback arrives, reject the code promise and close the server
    const onAbort = () => rejectCode(new Error('Login cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    // Clean up abort listener when code promise settles
    codePromise.finally(() => signal.removeEventListener('abort', onAbort))

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      log.info(`Callback server received request: ${req.method} ${req.url}`)

      if (!req.url?.startsWith('/callback')) {
        log.warn(`Unexpected request path (not /callback): ${req.url}`)
        res.writeHead(404)
        res.end()
        return
      }

      const url = new URL(req.url, 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        log.warn(`OAuth authorization denied by server: ${error}`)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(this.buildResultPage(false, `Authorization denied: ${error}`))
        rejectCode(new Error(`OAuth error: ${error}`))
        return
      }

      if (!code || !state) {
        log.warn('OAuth callback missing code or state parameter')
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(this.buildResultPage(false, 'Missing authorization code'))
        rejectCode(new Error('Missing code or state in OAuth callback'))
        return
      }

      log.info('OAuth callback received with authorization code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(this.buildResultPage(true, 'Your Claude subscription has been connected to OpenCow.'))
      resolveCode({ code, state })
    })

    // Listen on random port bound to IPv4 loopback.
    // MUST match the redirect URI which uses 127.0.0.1 (not localhost).
    await new Promise<void>((resolve, reject) => {
      server.on('listening', resolve)
      server.on('error', reject)
      server.listen(0, '127.0.0.1')
    })

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    if (port === 0) {
      server.close()
      throw new Error('Failed to bind callback server to a port')
    }

    log.info(`Callback server listening on 127.0.0.1:${port}`)
    return { server, port, codePromise }
  }

  /**
   * Build the OAuth authorization URL.
   *
   * IMPORTANT: The redirect_uri uses `127.0.0.1` (not `localhost`) to guarantee
   * the browser connects via IPv4 — matching the callback server bind address.
   * On modern macOS (Sonoma+), `localhost` may resolve to `::1` (IPv6 first),
   * causing the redirect to fail if the server only listens on IPv4.
   * RFC 8252 §7.3 explicitly allows `http://127.0.0.1` for native app OAuth.
   */
  private buildAuthUrl(port: number, challenge: string, state: string): string {
    const url = new URL(OAUTH_CONFIG.authorizeUrl)
    url.searchParams.set('code', 'true')
    url.searchParams.set('client_id', OAUTH_CONFIG.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', this.buildRedirectUri(port))
    url.searchParams.set('scope', OAUTH_CONFIG.scopes.join(' '))
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    return url.toString()
  }

  /** Canonical redirect URI — shared between authorize URL and token exchange. */
  private buildRedirectUri(port: number): string {
    return `http://127.0.0.1:${port}/callback`
  }

  private async exchangeCodeForTokens(params: {
    code: string
    verifier: string
    port: number
    state: string
  }): Promise<OAuthCredential> {
    const { code, verifier, port, state } = params

    // Use Electron's net.fetch (Chromium network stack) to avoid Cloudflare
    // bot detection that blocks Node.js fetch due to TLS fingerprint differences.
    // NOTE: We send `state` as a compatibility field because current upstream
    // OAuth implementations may enforce stricter request validation.
    const redirectUri = this.buildRedirectUri(port)
    const response = await net.fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        grant_type: 'authorization_code',
        client_id: OAUTH_CONFIG.clientId,
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
    return this.parseTokenResponse(data)
  }

  // ── Private: Token Refresh ──────────────────────────────────────────

  private async refreshToken(credential: OAuthCredential): Promise<void> {
    log.info('Refreshing OAuth access token')

    // Use Electron's net.fetch (Chromium network stack) — same reason as above.
    const response = await net.fetch(OAUTH_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: credential.refreshToken,
        client_id: OAUTH_CONFIG.clientId,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${body}`)
    }

    const data = (await response.json()) as Record<string, unknown>
    const refreshed = this.parseTokenResponse(data, {
      fallbackRefreshToken: credential.refreshToken,
    })

    await this.store.update('subscription', refreshed)
    log.info('Token refreshed successfully')
  }

  // ── Private: Helpers ────────────────────────────────────────────────

  private isTokenExpired(credential: OAuthCredential): boolean {
    return Date.now() >= credential.expiresAt - OAUTH_CONFIG.refreshBufferMs
  }

  /**
   * Parse a raw OAuth token response into a type-safe OAuthCredential.
   *
   * Performs **runtime validation** of all fields — no unsafe casts.
   * Accepts the opaque `Record<string, unknown>` from `response.json()` and
   * returns a fully validated credential or throws.
   *
   * @param raw         The raw JSON response body.
   * @param options.fallbackRefreshToken  When refreshing tokens, the server may
   *   omit refresh_token. Pass the existing token to preserve it.
   */
  private parseTokenResponse(
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
      scopes: scope?.split(' ') ?? [...OAUTH_CONFIG.scopes],
      // Capture subscription metadata if present (Anthropic extension fields)
      subscriptionType: typeof raw.subscription_type === 'string' ? raw.subscription_type : undefined,
      rateLimitTier: typeof raw.rate_limit_tier === 'string' ? raw.rate_limit_tier : undefined,
    }
  }

  private withAbortableTimeout<T>(
    promise: Promise<T>,
    ms: number,
    timeoutMessage: string,
    signal: AbortSignal
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
