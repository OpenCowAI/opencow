// SPDX-License-Identifier: Apache-2.0

/**
 * Internal types for the provider module.
 *
 * Shared types (ApiProvider, ProviderStatus, ProviderSettings) live in
 * src/shared/types.ts for IPC type safety. This file contains
 * implementation-level types used only by ProviderService and its adapters.
 */

// ── OAuth Token Shapes ──────────────────────────────────────────────

/** Persisted OAuth credential from the subscription (Pro/Max/Team/Enterprise) flow. */
export interface OAuthCredential {
  accessToken: string
  refreshToken: string
  /** Unix millisecond timestamp when accessToken expires. */
  expiresAt: number
  scopes: string[]
  subscriptionType?: string
  rateLimitTier?: string
}

/** Raw token response from the Anthropic OAuth token endpoint. */
export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope?: string
}

// ── Credential Store Shapes ─────────────────────────────────────────

/** Persisted OpenRouter credential. */
export interface OpenRouterCredential {
  apiKey: string
  /** Custom base URL for OpenRouter-compatible APIs. Falls back to the official endpoint if omitted. */
  baseUrl?: string
}

/** How the API key is transmitted to the custom endpoint. */
export type CustomAuthStyle =
  /** Standard Anthropic-style: key sent as `x-api-key` header via ANTHROPIC_API_KEY. */
  | 'api_key'
  /** OpenRouter-style: key sent as `Authorization: Bearer` via ANTHROPIC_AUTH_TOKEN. */
  | 'bearer'

/** Persisted credential for a user-defined Claude-compatible API endpoint. */
export interface CustomCredential {
  apiKey: string
  baseUrl: string
  authStyle: CustomAuthStyle
}

/** Top-level shape of the encrypted credential file. */
export interface StoredCredentials {
  subscription?: OAuthCredential
  apiKey?: string
  openrouter?: OpenRouterCredential
  custom?: CustomCredential
  [key: string]: unknown
}

// ── HTTP Auth Result ────────────────────────────────────────────────

/** Structured HTTP auth credentials for direct API calls (non-subprocess). */
export interface HTTPAuthResult {
  /** API key or OAuth access token */
  apiKey: string
  /** Fully-resolved base URL (no trailing slash, e.g. "https://api.anthropic.com") */
  baseUrl: string
  /** How the credential is sent in HTTP headers */
  authStyle: 'x-api-key' | 'bearer'
}

// ── Provider Adapter Interface ──────────────────────────────────────

export interface ProviderAdapterStatus {
  authenticated: boolean
  detail?: {
    email?: string
    organization?: string
    subscriptionType?: string
  }
  error?: string
}

/**
 * Common interface for all provider adapters.
 *
 * Each adapter knows how to:
 *   1. Check whether valid credentials exist
 *   2. Produce the env vars the SDK subprocess needs
 *   3. Perform the provider-specific login/configure flow
 *   4. Clean up credentials on logout
 */
export interface ProviderAdapter {
  /** Check if valid credentials exist for this provider. */
  checkStatus(): Promise<ProviderAdapterStatus>

  /**
   * Return environment variables to inject into the SDK subprocess.
   * May trigger a transparent token refresh if the current token is expired.
   */
  getEnv(): Promise<Record<string, string>>

  /**
   * Perform the provider-specific authentication flow.
   * For subscription: opens browser for OAuth.
   * For API key: validates and stores the key.
   * For OpenRouter: validates and stores the API key.
   */
  authenticate(params?: Record<string, unknown>): Promise<ProviderAdapterStatus>

  /**
   * Cancel an in-progress login flow (e.g. OAuth waiting for browser callback).
   * No-op if the provider doesn't support cancellation or no flow is active.
   */
  cancelLogin?(): Promise<void>

  /**
   * Return stored credential fields for pre-filling the edit form.
   * Providers that support editing should implement this.
   */
  getCredential?(): Promise<import('@shared/types').ProviderCredentialInfo | null>

  /**
   * Return structured HTTP auth credentials for direct API calls.
   *
   * Unlike `getEnv()` (env vars for SDK subprocess), this method returns
   * structured auth suitable for constructing HTTP headers in direct fetch() calls.
   *
   * Returns null if no valid credentials are stored.
   */
  getHTTPAuth(): Promise<HTTPAuthResult | null>

  /** Remove all stored credentials for this provider. */
  logout(): Promise<void>

  /**
   * Probe the upstream API with the stored credentials to verify auth.
   *
   * Contract (distinct from `checkStatus()`):
   *   - `checkStatus()` is a **local** check — does a credential blob
   *     exist, is the OAuth token not past its expiry? Cheap, fires on
   *     every status poll. Never throws.
   *   - `probe()` makes an actual HTTP request to the provider's
   *     lightest authenticated endpoint (typically `/v1/models`).
   *     Called on-demand from the Settings UI Test button. Returns a
   *     classified result so the caller can surface a meaningful
   *     error to the user.
   *
   * Implementations SHOULD use endpoints that:
   *   - Do not consume tokens or count toward usage
   *   - Distinguish 401 (auth failed) from 5xx (upstream down) from
   *     network errors (proxy / DNS / TLS)
   */
  probe(): Promise<ProbeResult>
}

export type ProbeResult =
  | { ok: true; detail?: string }
  | { ok: false; reason: 'unauthenticated' | 'network' | 'unsupported' | 'error'; message: string }

// ── OAuth Flow Timings ──────────────────────────────────────────────
//
// OAuth *wire* constants (client_id, authorize URL, token URL, scopes)
// live in `@opencow-ai/opencow-agent-sdk`'s `getOauthConfig()` +
// `CLAUDE_AI_OAUTH_SCOPES` — the SDK is the single source of truth
// for the Anthropic OAuth protocol. This file only keeps **timings**
// that are OpenCow's own orchestration policy:
//
//   - refreshBufferMs: proactive-refresh lead time (stricter than the
//     SDK's built-in 1-minute default — we want 5 to absorb clock drift
//     and network latency on the electron-vite dev restart)
//   - flowTimeoutMs: how long to wait for the browser callback before
//     giving up the OAuth dance. Driven by UX: 3 minutes is long enough
//     for the user to complete login + MFA without being intrusive,
//     short enough to make "I closed the browser tab" recoverable.

export const OAUTH_FLOW_TIMINGS = {
  /** Buffer before actual expiry to trigger proactive refresh (5 minutes). */
  refreshBufferMs: 5 * 60 * 1000,
  /** Timeout for the entire OAuth browser flow (3 minutes). */
  flowTimeoutMs: 3 * 60 * 1000,
} as const
