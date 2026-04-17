// SPDX-License-Identifier: Apache-2.0

/**
 * LLM abstraction types — contracts for engine-agnostic LLM access.
 *
 * This module defines the structured auth config returned by
 * ProviderService.resolveHTTPAuth(), consumed by HeadlessLLMClient
 * for direct HTTP API calls to Anthropic or OpenAI endpoints.
 */

// ─── Auth Config ─────────────────────────────────────────────

/**
 * Structured HTTP auth config resolved by ProviderService.
 *
 * Combines adapter-level credentials (apiKey, baseUrl, authStyle)
 * with engine-level config (protocol, model) to produce a complete
 * config for direct LLM API calls.
 */
export interface LLMAuthConfig {
  /** API protocol — determines request format and endpoint path */
  protocol: 'anthropic' | 'openai' | 'gemini'
  /** API key or OAuth access token */
  apiKey: string
  /** Base URL (no trailing slash, no path, e.g. "https://api.anthropic.com") */
  baseUrl: string
  /** How the credential is sent in HTTP headers */
  authStyle: 'x-api-key' | 'bearer'
  /** Model identifier (e.g. "claude-sonnet-4-20250514", "gpt-4o-mini") */
  model: string
}

// ─── HeadlessLLMClient ───────────────────────────────────────

export interface HeadlessQueryParams {
  systemPrompt: string
  userMessage: string
  /** Max output tokens. Default: 4096 */
  maxTokens?: number
  /** Request timeout in ms. Default: 30_000 */
  timeoutMs?: number
}

export interface HeadlessLLMClient {
  query(params: HeadlessQueryParams): Promise<string>
}

export interface HeadlessClientDeps {
  /** Resolves structured HTTP auth (engine-aware, dynamic per call) */
  resolveAuth: () => Promise<LLMAuthConfig>
  /** Returns a proxy-aware fetch function */
  getFetch: () => typeof globalThis.fetch
}
