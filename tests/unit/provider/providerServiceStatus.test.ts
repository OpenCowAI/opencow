// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { ProviderService } from '../../../electron/services/provider/providerService'
import type { ApiProvider, ProviderSettings } from '../../../src/shared/types'
import type { ProviderAdapter } from '../../../electron/services/provider/types'

function createProviderServiceForStatusTest(params: {
  mode: ApiProvider | null
  adapter: ProviderAdapter
}): ProviderService {
  const settings: ProviderSettings = {
    activeMode: params.mode,
  }

  const service = Object.create(ProviderService.prototype) as ProviderService & {
    deps: unknown
    providers: unknown
  }
  service.deps = {
    dispatch: () => {},
    credentialStore: {} as never,
    getProviderSettings: () => settings,
  }
  service.providers = new Map<ApiProvider, ProviderAdapter>(
    params.mode ? [[params.mode, params.adapter]] : [],
  )
  return service as ProviderService
}

describe('ProviderService.getStatus', () => {
  it('returns authenticated when adapter confirms auth', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: true }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: true }),
      getHTTPAuth: async () => null,
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({ mode: 'api_key', adapter })

    const status = await service.getStatus()
    expect(status.state).toBe('authenticated')
    expect(status.mode).toBe('api_key')
  })

  it('returns unauthenticated when no mode is configured', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: false }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: false }),
      getHTTPAuth: async () => null,
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({ mode: null, adapter })

    const status = await service.getStatus()
    expect(status.state).toBe('unauthenticated')
    expect(status.mode).toBeNull()
  })
})
