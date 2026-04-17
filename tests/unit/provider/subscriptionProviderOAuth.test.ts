// SPDX-License-Identifier: Apache-2.0

/**
 * SubscriptionProvider OAuth orchestration tests.
 *
 * Post-consolidation (plans/anthropic-auth-consolidation.md): the OAuth
 * wire protocol (PKCE, URL builders, local listener, token exchange,
 * refresh) is delegated to `@opencow-ai/opencow-agent-sdk`. Those SDK
 * units are already tested in the SDK's own suite.
 *
 * These tests cover what OpenCow still owns: the orchestration layer —
 * mutex-guarded login, AbortController cancel, profile-scoped
 * CredentialStore persistence, token-expiry detection + refresh
 * fan-out, lossless preservation of subscription metadata across refresh.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const shellOpenExternalMock = vi.fn()
const netFetchMock = vi.fn()
vi.mock('electron', () => ({
  shell: {
    openExternal: (...args: unknown[]) => shellOpenExternalMock(...args),
  },
  net: {
    fetch: (...args: unknown[]) => netFetchMock(...args),
  },
}))

// ── SDK mock ──────────────────────────────────────────────────────
// We stub the SDK entry so the provider exercises its orchestration
// in isolation. The stubs intentionally mimic the real SDK surface so
// any contract drift surfaces as a type error.
//
// vi.mock is hoisted to module top, so fakes + mock functions are
// constructed inside the factory and reached via the `__sdk` handle
// re-exported below.
vi.mock('@opencow-ai/opencow-agent-sdk', () => {
  let listenerFactory: () => FakeAuthCodeListener = () => new FakeAuthCodeListener()

  class FakeAuthCodeListener {
    port = 0
    closed = false
    async start(): Promise<number> {
      this.port = 55555
      return this.port
    }
    async waitForAuthorization(_state: string, onReady: () => Promise<void>): Promise<string> {
      await onReady()
      return 'auth-code-stub'
    }
    handleSuccessRedirect(_scopes: string[], customHandler?: (res: unknown) => void): void {
      customHandler?.({ writeHead: () => undefined, end: () => undefined })
    }
    close(): void {
      this.closed = true
    }
  }

  // Proxy so test code can swap the constructor with a subclass that
  // hangs forever (to test cancel).
  class AuthCodeListenerProxy {
    private inner: FakeAuthCodeListener
    constructor() {
      this.inner = listenerFactory()
    }
    start(): Promise<number> { return this.inner.start() }
    waitForAuthorization(state: string, onReady: () => Promise<void>): Promise<string> {
      return this.inner.waitForAuthorization(state, onReady)
    }
    handleSuccessRedirect(scopes: string[], customHandler?: (res: unknown) => void): void {
      this.inner.handleSuccessRedirect(scopes, customHandler)
    }
    close(): void { this.inner.close() }
  }

  return {
    AuthCodeListener: AuthCodeListenerProxy,
    buildAuthUrl: vi.fn(() => 'https://claude.com/cai/oauth/authorize?stub=1'),
    generateCodeVerifier: vi.fn(() => 'verifier-stub'),
    generateCodeChallenge: vi.fn(async () => 'challenge-stub'),
    generateState: vi.fn(() => 'state-stub'),
    isOAuthTokenExpired: vi.fn((expiresAt: number) => Date.now() >= expiresAt - 60_000),
    parseScopes: vi.fn((s: string | undefined) => (s ? s.split(' ').filter(Boolean) : [])),
    getOauthConfig: vi.fn(() => ({
      CLIENT_ID: 'test-client-id',
      TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
    })),
    __sdk: {
      FakeAuthCodeListener,
      setListenerFactory: (f: () => FakeAuthCodeListener) => { listenerFactory = f },
      resetListenerFactory: () => { listenerFactory = () => new FakeAuthCodeListener() },
    },
  }
})

import { SubscriptionProvider } from '../../../electron/services/provider/providers/subscription'
// Reach into the mocked SDK to drive test scenarios. `__sdk` is an
// internal handle added by the factory above — the real package does
// not export it.
import * as sdkMock from '@opencow-ai/opencow-agent-sdk'
// biome-ignore lint/suspicious/noExplicitAny: test hook
const __sdk = (sdkMock as any).__sdk as {
  FakeAuthCodeListener: new () => {
    start(): Promise<number>
    waitForAuthorization(state: string, onReady: () => Promise<void>): Promise<string>
    handleSuccessRedirect(scopes: string[], customHandler?: (res: unknown) => void): void
    close(): void
  }
  setListenerFactory: (f: () => InstanceType<(typeof __sdk)['FakeAuthCodeListener']>) => void
  resetListenerFactory: () => void
}

// Small helper to build a `net.fetch`-shaped response so tests stay readable.
function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

class MockCredentialStore {
  private readonly state: Record<string, unknown> = {}
  async get(key: string): Promise<unknown> {
    return this.state[key]
  }
  async getAs<U>(key: string): Promise<U | undefined> {
    return this.state[key] as U | undefined
  }
  async update(key: string, value: unknown): Promise<void> {
    this.state[key] = value
  }
  async updateAs<U>(key: string, value: U): Promise<void> {
    this.state[key] = value
  }
  async remove(key: string): Promise<void> {
    delete this.state[key]
  }
  async removeAt(key: string): Promise<void> {
    delete this.state[key]
  }
}

describe('SubscriptionProvider orchestration', () => {
  beforeEach(() => {
    shellOpenExternalMock.mockReset()
    netFetchMock.mockReset()
    __sdk.resetListenerFactory()
  })

  it('delegates the OAuth flow to SDK primitives and persists tokens in a profile-scoped slot', async () => {
    // Happy path — `net.fetch` is the boundary (HTTP call stays in
    // OpenCow so Electron's Chromium network stack bypasses the
    // Cloudflare 403 that Node-axios triggers on the token endpoint).
    // All other primitives (PKCE / listener / URL build) come from the
    // SDK mock, so any contract drift shows up as a failing test.
    netFetchMock.mockResolvedValueOnce(
      jsonOk({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'user:inference user:profile',
      }),
    )

    const store = new MockCredentialStore()
    const provider = new SubscriptionProvider(store as never, 'credential:prof_abc')
    const result = await provider.authenticate()

    expect(result.authenticated).toBe(true)
    expect(shellOpenExternalMock).toHaveBeenCalledTimes(1)
    expect(shellOpenExternalMock).toHaveBeenCalledWith(expect.stringContaining('claude.com/cai/oauth/authorize'))

    // net.fetch body is the RFC 6749 §4.1.3 shape + Anthropic's `state`
    // echo. Assert each field so future accidental drift (e.g.
    // dropping `state` or swapping grant_type) fails here.
    expect(netFetchMock).toHaveBeenCalledTimes(1)
    const [tokenUrl, reqInit] = netFetchMock.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://platform.claude.com/v1/oauth/token')
    expect(reqInit.method).toBe('POST')
    const reqBody = JSON.parse(String(reqInit.body)) as Record<string, string>
    expect(reqBody).toMatchObject({
      code: 'auth-code-stub',
      grant_type: 'authorization_code',
      client_id: 'test-client-id',
      redirect_uri: 'http://localhost:55555/callback',
      code_verifier: 'verifier-stub',
      state: 'state-stub',
    })

    const stored = await store.get('credential:prof_abc') as Record<string, unknown>
    expect(stored.accessToken).toBe('access-token')
    expect(stored.refreshToken).toBe('refresh-token')
    expect(stored.scopes).toEqual(['user:inference', 'user:profile'])
    expect(typeof stored.expiresAt).toBe('number')
    expect(stored.expiresAt as number).toBeGreaterThan(Date.now() + 3_590_000)

    // Guarantee the global default slot was NOT written — that slot
    // is for sessions without an explicit profileId.
    expect(await store.get('subscription')).toBeUndefined()
  })

  it('refreshes expired tokens and preserves subscription metadata when the server omits it', async () => {
    // Refresh protocol nuance: Anthropic's refresh grant frequently
    // omits subscription_type / rate_limit_tier (those live on the
    // profile endpoint, not the token endpoint). The provider must
    // preserve the previously persisted values so a "Claude Max"
    // badge doesn't blank out after every refresh cycle.
    const store = new MockCredentialStore()
    await store.update('subscription', {
      accessToken: 'expired-token',
      refreshToken: 'refresh-token-old',
      expiresAt: Date.now() - 1,
      scopes: ['user:inference'],
      subscriptionType: 'claude_max',
      rateLimitTier: 'tier3',
    })

    netFetchMock.mockResolvedValueOnce(
      jsonOk({
        access_token: 'access-token-new',
        refresh_token: 'refresh-token-new',
        expires_in: 3600,
        scope: 'user:inference',
        // NOTE: subscription_type + rate_limit_tier intentionally absent
      }),
    )

    const provider = new SubscriptionProvider(store as never)
    const status = await provider.checkStatus()

    expect(status.authenticated).toBe(true)
    // Refresh wire shape: grant_type + refresh_token + client_id
    expect(netFetchMock).toHaveBeenCalledTimes(1)
    const [, reqInit] = netFetchMock.mock.calls[0] as [string, RequestInit]
    const reqBody = JSON.parse(String(reqInit.body)) as Record<string, string>
    expect(reqBody).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-token-old',
      client_id: 'test-client-id',
    })

    const updated = await store.get('subscription') as Record<string, unknown>
    expect(updated.accessToken).toBe('access-token-new')
    expect(updated.refreshToken).toBe('refresh-token-new')
    expect(updated.subscriptionType).toBe('claude_max')
    expect(updated.rateLimitTier).toBe('tier3')
  })

  it('preserves the existing refresh token when the server omits refresh_token on refresh', async () => {
    // Some Anthropic refresh responses include a new refresh_token,
    // some don't (access-token-only rotation). When omitted we MUST
    // keep the old refresh_token or the next expiry becomes terminal.
    const store = new MockCredentialStore()
    await store.update('subscription', {
      accessToken: 'expired',
      refreshToken: 'rt-keep-me',
      expiresAt: Date.now() - 1,
      scopes: ['user:inference'],
    })

    netFetchMock.mockResolvedValueOnce(
      jsonOk({
        access_token: 'access-fresh',
        // refresh_token intentionally absent
        expires_in: 3600,
        scope: 'user:inference',
      }),
    )

    const provider = new SubscriptionProvider(store as never)
    await provider.checkStatus()

    const updated = await store.get('subscription') as Record<string, unknown>
    expect(updated.refreshToken).toBe('rt-keep-me')
  })

  it('blocks concurrent login attempts with a clear error rather than spawning two browsers', async () => {
    // The IPC surface doesn't guarantee serialization — a fast double-
    // click on "Login" from the renderer can arrive as two
    // authenticate() calls. Opening two browsers + starting two
    // listeners would clobber state. The mutex returns a polite error
    // on the second call so the UI can show a spinner instead.
    let resolveGate: () => void = () => {}
    const gate = new Promise<void>((r) => { resolveGate = r })
    netFetchMock.mockImplementation(async () => {
      await gate
      return jsonOk({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        scope: '',
      })
    })

    const provider = new SubscriptionProvider(new MockCredentialStore() as never)
    const firstPromise = provider.authenticate()
    // Yield a tick so the first call takes the lock.
    await Promise.resolve()
    const secondResult = await provider.authenticate()

    expect(secondResult.authenticated).toBe(false)
    expect(secondResult.error).toMatch(/in progress/i)

    resolveGate()
    await firstPromise
  })

  it('cancel aborts the in-flight OAuth and reports "Login cancelled"', async () => {
    // Install a hanging listener (waitForAuthorization never resolves
    // on its own) via the factory hook exposed on `__sdk`. cancelLogin
    // should abort the timeout/wait race and produce the stable error
    // string the UI binds to.
    __sdk.setListenerFactory(() => {
      const base = new __sdk.FakeAuthCodeListener()
      base.waitForAuthorization = async (_state: string, onReady: () => Promise<void>) => {
        await onReady()
        return new Promise<string>(() => {
          /* never resolves — must be aborted */
        })
      }
      return base
    })

    try {
      const provider = new SubscriptionProvider(new MockCredentialStore() as never)
      const authPromise = provider.authenticate()
      // Drain several microtask + macrotask cycles so performOAuthFlow
      // progresses past all its internal awaits (generateCodeChallenge,
      // listener.start, shell.openExternal) before we fire cancel.
      await new Promise((r) => setTimeout(r, 10))
      await provider.cancelLogin()
      const result = await authPromise

      expect(result.authenticated).toBe(false)
      expect(result.error).toBe('Login cancelled')
    } finally {
      __sdk.resetListenerFactory()
    }
  })

  it('returns a skip-authenticated status when no credential is stored yet', async () => {
    // Baseline: fresh install, nothing in the credential store.
    // Neither refresh nor exchange should be invoked.
    const store = new MockCredentialStore()
    const provider = new SubscriptionProvider(store as never)
    const status = await provider.checkStatus()
    expect(status).toEqual({ authenticated: false })
    expect(netFetchMock).not.toHaveBeenCalled()
  })

  it('logout wipes only the profile-scoped slot it was constructed with', async () => {
    // Defense: a multi-profile app with profile A and profile B must
    // see `A.logout()` clear only A's credential — not B's.
    const store = new MockCredentialStore()
    await store.update('credential:prof_A', { accessToken: 'A', refreshToken: 'rA', expiresAt: Date.now() + 3_600_000, scopes: [] })
    await store.update('credential:prof_B', { accessToken: 'B', refreshToken: 'rB', expiresAt: Date.now() + 3_600_000, scopes: [] })

    const providerA = new SubscriptionProvider(store as never, 'credential:prof_A')
    await providerA.logout()

    expect(await store.get('credential:prof_A')).toBeUndefined()
    expect(await store.get('credential:prof_B')).toBeDefined()
  })
})
