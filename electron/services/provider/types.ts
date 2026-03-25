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

/** Normalized Codex auth config resolved from a provider adapter. */
export interface CodexAuthConfig {
  apiKey: string
  baseUrl?: string
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
   * Return Codex SDK auth options (`apiKey/baseUrl`) when this provider can
   * be represented as an OpenAI-compatible endpoint.
   *
   * Return null for unsupported provider modes (e.g. Claude subscription / Anthropic API key).
   */
  getCodexAuthConfig?(): Promise<CodexAuthConfig | null>

  /** Remove all stored credentials for this provider. */
  logout(): Promise<void>
}

// ── OAuth Constants ─────────────────────────────────────────────────

export const OAUTH_CONFIG = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  scopes: ['user:inference', 'user:profile', 'user:mcp_servers', 'user:sessions:claude_code'],
  /** Buffer before actual expiry to trigger proactive refresh (5 minutes). */
  refreshBufferMs: 5 * 60 * 1000,
  /** Timeout for the entire OAuth browser flow (3 minutes). */
  flowTimeoutMs: 3 * 60 * 1000,
} as const
