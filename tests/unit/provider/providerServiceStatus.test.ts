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
      codex: { activeMode: null },
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
    ['codex', new Map(params.mode ? [[params.mode, params.adapter]] : [])],
  ])
  return service as ProviderService
}

describe('ProviderService.getStatus', () => {
  it('marks codex mode unauthenticated when adapter has no codex auth mapping', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: true }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: true }),
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({
      engineKind: 'codex',
      mode: 'custom',
      adapter,
    })

    const status = await service.getStatus('codex')
    expect(status.state).toBe('unauthenticated')
    expect(status.mode).toBe('custom')
  })

  it('marks codex mode unauthenticated when codex auth mapping has no apiKey', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: true }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: true }),
      getCodexAuthConfig: async () => null,
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({
      engineKind: 'codex',
      mode: 'openrouter',
      adapter,
    })

    const status = await service.getStatus('codex')
    expect(status.state).toBe('unauthenticated')
    expect(status.mode).toBe('openrouter')
  })

  it('keeps codex mode authenticated when codex auth mapping is available', async () => {
    const adapter: ProviderAdapter = {
      checkStatus: async () => ({ authenticated: true }),
      getEnv: async () => ({}),
      authenticate: async () => ({ authenticated: true }),
      getCodexAuthConfig: async () => ({ apiKey: 'sk-test', baseUrl: 'https://example.com/v1' }),
      logout: async () => {},
    }
    const service = createProviderServiceForStatusTest({
      engineKind: 'codex',
      mode: 'custom',
      adapter,
    })

    const status = await service.getStatus('codex')
    expect(status.state).toBe('authenticated')
    expect(status.mode).toBe('custom')
  })
})
