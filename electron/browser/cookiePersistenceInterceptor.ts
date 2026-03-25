// SPDX-License-Identifier: Apache-2.0

import type { Session, Cookie, CookiesSetDetails } from 'electron'
import { createLogger } from '../platform/logger'

const log = createLogger('CookiePersistence')

/**
 * Configuration for the Cookie Persistence Interceptor.
 */
export interface CookiePersistenceConfig {
  /** Default TTL in seconds for converted cookies (default: 30 days) */
  defaultTTL: number
  /** Domain allowlist — empty means allow all */
  allowedDomains: string[]
}

/**
 * CookiePersistenceInterceptor — converts session cookies to persistent cookies.
 *
 * Many websites (Boss Zhipin, Twitter, etc.) set session-only cookies (no expirationDate).
 * These are lost when the Electron app restarts, even with `persist:` partition.
 *
 * This interceptor monitors cookie changes and automatically converts session cookies
 * to persistent cookies by adding an expirationDate.
 *
 * Safety mechanisms:
 * - Checks `cause === 'explicit'` to ignore cookies we set ourselves (prevents recursive loop)
 * - Uses a `convertingKeys` Set as a secondary guard against re-entrant conversion
 * - Only converts cookies from allowed domains (configurable)
 */
export class CookiePersistenceInterceptor {
  private readonly convertingKeys = new Set<string>()
  private started = false

  constructor(
    private readonly session: Session,
    private readonly config: CookiePersistenceConfig,
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.session.cookies.on('changed', this.handleCookieChange)
    log.debug('Cookie persistence interceptor started')
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.session.cookies.removeListener('changed', this.handleCookieChange)
    log.debug('Cookie persistence interceptor stopped')
  }

  updateConfig(config: Partial<CookiePersistenceConfig>): void {
    if (config.defaultTTL !== undefined) {
      (this.config as CookiePersistenceConfig).defaultTTL = config.defaultTTL
    }
    if (config.allowedDomains !== undefined) {
      (this.config as CookiePersistenceConfig).allowedDomains = config.allowedDomains
    }
  }

  // ── Private ─────────────────────────────────────────────────────────

  private handleCookieChange = (
    _event: Electron.Event,
    cookie: Cookie,
    cause: string,
    removed: boolean,
  ): void => {
    // Skip removals
    if (removed) return

    // Skip cookies that already have an expiration date
    if (cookie.expirationDate) return

    // Skip cookies we set ourselves (cause='explicit' when using cookies.set())
    if (cause === 'explicit') return

    // Domain allowlist check
    if (!cookie.domain || !this.isDomainAllowed(cookie.domain)) return

    // Re-entrancy guard
    const key = `${cookie.domain}:${cookie.name}`
    if (this.convertingKeys.has(key)) return

    this.convertingKeys.add(key)
    this.persistCookie(cookie)
      .catch((err) => {
        log.error(`Failed to persist cookie ${key}`, err)
      })
      .finally(() => {
        this.convertingKeys.delete(key)
      })
  }

  private async persistCookie(cookie: Cookie): Promise<void> {
    const domain = (cookie.domain ?? '').replace(/^\./, '')
    const protocol = cookie.secure ? 'https' : 'http'
    const url = `${protocol}://${domain}${cookie.path}`

    const details: CookiesSetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as CookiesSetDetails['sameSite'],
      expirationDate: Math.floor(Date.now() / 1000) + this.config.defaultTTL,
    }

    await this.session.cookies.set(details)
  }

  private isDomainAllowed(domain: string): boolean {
    const { allowedDomains } = this.config
    // Empty list = allow all
    if (allowedDomains.length === 0) return true

    const hostname = domain.replace(/^\./, '')
    return allowedDomains.some((pattern) => {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1) // ".zhipin.com"
        return hostname.endsWith(suffix) || hostname === pattern.slice(2)
      }
      return hostname === pattern
    })
  }
}
