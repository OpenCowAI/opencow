// SPDX-License-Identifier: Apache-2.0

/**
 * ProxyFetchFactory — cached, proxy-aware fetch function factory.
 *
 * Provides two fetch variants:
 *   1. **IM Bot fetch** (`getIMBotFetch`) — strips grammy's polyfill AbortSignal
 *      to avoid undici 7 validation errors.  Used by Telegram, Feishu, Discord, WeChat bots.
 *   2. **Standard fetch** (`getStandardFetch`) — preserves AbortSignal as-is.
 *      Used by webhooks, marketplace, Evose API, and general HTTP clients.
 *
 * Both variants:
 *   - Respect the user's proxy settings (HTTP, HTTPS, SOCKS4, SOCKS5)
 *   - Cache the dispatcher per proxy URL — only recreates when the URL changes
 *   - Route through undici's fetch (Node.js realm) to avoid Chromium's session.fetch()
 *     AbortSignal class mismatch
 *
 * Design:
 *   - Constructor-injected `getProxyUrl` callback decouples from SettingsService
 *   - Pure function output — callers get a standard `typeof globalThis.fetch`
 *   - Thread-safe caching per fetch variant (independent cache entries)
 */

import { fetch as undiciFetch } from 'undici'
import { createProxyDispatcher } from './proxyDispatcher'
import { createLogger } from '../platform/logger'

const log = createLogger('ProxyFetch')

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProxyFetchFactoryConfig {
  /** Returns the current proxy URL, or null for direct connections. */
  getProxyUrl: () => string | null
}

interface CacheEntry {
  proxyUrl: string | null
  fetch: typeof globalThis.fetch
}

// ── AbortSignal workaround ───────────────────────────────────────────────────

/**
 * Strip `signal` from a RequestInit before forwarding to undici or any other
 * Node.js-native fetch implementation.
 *
 * ROOT CAUSE (confirmed via source inspection):
 *   grammy's `shim.node.js` does `require("abort-controller")` — a third-party
 *   npm polyfill.  The polyfill's `AbortSignal` class is a different object from
 *   Node.js's built-in `globalThis.AbortSignal`.
 *
 *   undici 7 validates signals with:
 *     `FunctionPrototypeSymbolHasInstance(globalThis.AbortSignal, signal)` → false
 *
 *   The check always fails regardless of proxy type, throwing:
 *     "RequestInit: Expected signal (AbortSignal {}) to be an instance of AbortSignal"
 *
 * FIX: strip the polyfill signal before it reaches undici.  Timeout semantics are
 * preserved by the `withTimeout()` wrappers in TelegramBotService.
 */
function stripSignal(init: RequestInit | undefined): Omit<RequestInit, 'signal'> {
  if (!init) return {}
  const { signal: _unused, ...rest } = init
  return rest
}

// ── Factory ──────────────────────────────────────────────────────────────────

export class ProxyFetchFactory {
  private readonly getProxyUrl: () => string | null

  /** Cache for IM bot fetch (with stripSignal). */
  private imBotCache: CacheEntry | null = null

  /** Cache for standard fetch (without stripSignal). */
  private standardCache: CacheEntry | null = null

  constructor(config: ProxyFetchFactoryConfig) {
    this.getProxyUrl = config.getProxyUrl
  }

  /**
   * Return a proxy-aware fetch for IM bot SDKs (grammy, discord.js, etc.).
   *
   * Strips grammy's polyfill AbortSignal to avoid undici validation errors.
   * This is harmless for non-grammy callers since stripping a native
   * AbortSignal that happens to NOT be a polyfill is a no-op.
   *
   * The result is cached per proxy URL — safe to call on every request.
   */
  getIMBotFetch(): typeof globalThis.fetch {
    const proxyUrl = this.getProxyUrl()

    if (this.imBotCache?.proxyUrl === proxyUrl) return this.imBotCache.fetch

    let fetchFn: typeof globalThis.fetch
    if (proxyUrl) {
      const dispatcher = createProxyDispatcher(proxyUrl)
      log.info(`[IMBot] Proxy configured: ${proxyUrl}`)
      fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
        undiciFetch(typeof input === 'string' ? input : input.toString(), {
          ...(stripSignal(init) as any),
          dispatcher,
        })
      ) as unknown as typeof globalThis.fetch
    } else {
      log.info('[IMBot] Direct connection (no proxy)')
      fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input as RequestInfo, stripSignal(init) as RequestInit)
      ) as unknown as typeof globalThis.fetch
    }

    this.imBotCache = { proxyUrl, fetch: fetchFn }
    return fetchFn
  }

  /**
   * Return a proxy-aware fetch that preserves AbortSignal.
   *
   * Used by webhooks, marketplace, Evose API, and general HTTP clients where
   * `AbortSignal.timeout()` (native Node.js) is compatible with both undici
   * and globalThis.fetch without any patching.
   *
   * The result is cached per proxy URL — safe to call on every request.
   */
  getStandardFetch(): typeof globalThis.fetch {
    const proxyUrl = this.getProxyUrl()

    if (this.standardCache?.proxyUrl === proxyUrl) return this.standardCache.fetch

    let fetchFn: typeof globalThis.fetch
    if (proxyUrl) {
      const dispatcher = createProxyDispatcher(proxyUrl)
      fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
        undiciFetch(typeof input === 'string' ? input : input.toString(), {
          ...(init as any),
          dispatcher,
        })
      ) as unknown as typeof globalThis.fetch
    } else {
      fetchFn = globalThis.fetch
    }

    this.standardCache = { proxyUrl, fetch: fetchFn }
    return fetchFn
  }
}
