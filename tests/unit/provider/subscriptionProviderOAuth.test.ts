// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get as httpGet } from 'http'

const netFetchMock = vi.fn()
const openExternalMock = vi.fn()

vi.mock('electron', () => ({
  net: {
    fetch: (...args: unknown[]) => netFetchMock(...args),
  },
  shell: {
    openExternal: (...args: unknown[]) => openExternalMock(...args),
  },
}))

import { SubscriptionProvider } from '../../../electron/services/provider/providers/subscription'
import { OAUTH_CONFIG } from '../../../electron/services/provider/types'

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

describe('SubscriptionProvider OAuth config and request payload', () => {
  beforeEach(() => {
    netFetchMock.mockReset()
    openExternalMock.mockReset()
  })

  async function sendLoopbackCallback(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const req = httpGet(url, (res) => {
        res.resume()
        res.on('end', () => resolve())
      })
      req.on('error', reject)
    })
  }

  it('uses the current production OAuth endpoints and scopes', () => {
    expect(OAUTH_CONFIG.authorizeUrl).toBe('https://claude.com/cai/oauth/authorize')
    expect(OAUTH_CONFIG.tokenUrl).toBe('https://platform.claude.com/v1/oauth/token')
    expect(OAUTH_CONFIG.scopes).toEqual(expect.arrayContaining([
      'user:inference',
      'user:profile',
      'user:mcp_servers',
      'user:sessions:claude_code',
      'user:file_upload',
    ]))
  })

  it('authenticates through public API and sends state in token exchange body', async () => {
    netFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'user:inference user:profile',
      }),
    })

    openExternalMock.mockImplementation(async (authUrl: string) => {
      const parsed = new URL(authUrl)
      const redirectUri = parsed.searchParams.get('redirect_uri')
      const state = parsed.searchParams.get('state')
      if (!redirectUri || !state) {
        throw new Error('OAuth authorize URL missing redirect_uri or state')
      }

      const callbackUrl = new URL(redirectUri)
      callbackUrl.searchParams.set('code', 'auth-code')
      callbackUrl.searchParams.set('state', state)
      await sendLoopbackCallback(callbackUrl.toString())
    })

    const store = new MockCredentialStore()
    const provider = new SubscriptionProvider(store as never)
    const result = await provider.authenticate()

    expect(result.authenticated).toBe(true)
    expect(openExternalMock).toHaveBeenCalledTimes(1)
    expect(netFetchMock).toHaveBeenCalledTimes(1)

    const authUrl = String(openExternalMock.mock.calls[0]?.[0] ?? '')
    const parsed = new URL(authUrl)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://claude.com/cai/oauth/authorize')
    expect(parsed.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(parsed.searchParams.get('state')).toBeTruthy()
    expect(parsed.searchParams.get('scope')?.split(' ')).toEqual(expect.arrayContaining(OAUTH_CONFIG.scopes))

    const [requestUrl, requestInit] = netFetchMock.mock.calls[0] as [
      string,
      { method?: string; body?: unknown },
    ]
    expect(requestUrl).toBe('https://platform.claude.com/v1/oauth/token')
    expect(requestInit.method).toBe('POST')

    const body = JSON.parse(String(requestInit.body)) as Record<string, string>
    expect(body).toMatchObject({
      code: 'auth-code',
      grant_type: 'authorization_code',
      client_id: OAUTH_CONFIG.clientId,
      state: parsed.searchParams.get('state'),
    })
    expect(body.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(typeof body.code_verifier).toBe('string')
    expect(body.code_verifier.length).toBeGreaterThan(0)

    const storedCredential = await store.get('subscription') as { accessToken?: string }
    expect(storedCredential.accessToken).toBe('access-token')
  })

  it('refreshes expired token through current token endpoint', async () => {
    const store = new MockCredentialStore()
    await store.update('subscription', {
      accessToken: 'expired-token',
      refreshToken: 'refresh-token-old',
      expiresAt: Date.now() - 1,
      scopes: ['user:inference'],
    })

    netFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token-new',
        refresh_token: 'refresh-token-new',
        expires_in: 3600,
        scope: 'user:inference',
      }),
    })

    const provider = new SubscriptionProvider(store as never)
    const status = await provider.checkStatus()

    expect(status.authenticated).toBe(true)
    expect(netFetchMock).toHaveBeenCalledTimes(1)

    const [requestUrl, requestInit] = netFetchMock.mock.calls[0] as [
      string,
      { method?: string; body?: unknown },
    ]
    expect(requestUrl).toBe('https://platform.claude.com/v1/oauth/token')
    expect(requestInit.method).toBe('POST')

    const body = JSON.parse(String(requestInit.body)) as Record<string, string>
    expect(body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-token-old',
      client_id: OAUTH_CONFIG.clientId,
    })
  })
})
