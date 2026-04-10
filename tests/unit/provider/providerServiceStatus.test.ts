// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { ProviderService } from '../../../electron/services/provider/providerService'
import type { AIEngineKind, ApiProvider, ProviderSettings } from '../../../src/shared/types'
import type { ProviderAdapter } from '../../../electron/services/provider/types'

function createProviderServiceForStatusTest(params: {
  engineKind: AIEngineKind
  mode: ApiProvider | null
  adapter: ProviderAdapter
}): ProviderService {
  const settings: ProviderSettings = {
    byEngine: {
      claude: { activeMode: null },
    },
  }
  settings.byEngine[params.engineKind].activeMode = params.mode

  const service = Object.create(ProviderService.prototype) as ProviderService & {
    deps: unknown
    providersByEngine: unknown
  }
  service.deps = {
    dispatch: () => {},
    credentialStoreByEngine: {} as never,
    getProviderSettings: () => settings,
  }
  service.providersByEngine = new Map<AIEngineKind, Map<ApiProvider, ProviderAdapter>>([
    ['claude', new Map(params.mode ? [[params.mode, params.adapter]] : [])],
  ])
  return service as ProviderService
}

describe('ProviderService.getStatus', () => {
  it('returns authenticated when claude adapter confirms auth', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: true }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: true }),
      getHTTPAuth: async () => null,
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({
      engineKind: 'claude',
      mode: 'api_key',
      adapter,
    })

    const status = await service.getStatus('claude')
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
    const service = createProviderServiceForStatusTest({
      engineKind: 'claude',
      mode: null,
      adapter,
    })

    const status = await service.getStatus('claude')
    expect(status.state).toBe('unauthenticated')
    expect(status.mode).toBeNull()
  })
})
