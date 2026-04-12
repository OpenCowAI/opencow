// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  asProviderProfileId,
  credentialKeyFor,
  generateProviderProfileId,
  isProviderTypeImplemented,
  legacyCredentialKey,
  migrateLegacyProviderSettings,
  type ProviderProfileSettings,
} from '../../../src/shared/providerProfile'

const NOW = '2026-04-12T20:00:00.000Z'
const STUB_ID = asProviderProfileId('prof_testid0001')
const stubIdFactory = () => STUB_ID
const stubNow = () => NOW

describe('generateProviderProfileId', () => {
  it('produces `prof_` prefix followed by 10 alphanumeric chars', () => {
    const id = generateProviderProfileId()
    expect(id).toMatch(/^prof_[a-z0-9]{10}$/)
  })

  it('produces distinct ids across calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(generateProviderProfileId())
    expect(seen.size).toBe(50)
  })
})

describe('isProviderTypeImplemented', () => {
  it('flags Anthropic-native types as implemented in Phase B', () => {
    expect(isProviderTypeImplemented('claude-subscription')).toBe(true)
    expect(isProviderTypeImplemented('anthropic-api')).toBe(true)
    expect(isProviderTypeImplemented('anthropic-compat-proxy')).toBe(true)
  })

  it('flags non-Anthropic and cloud types as NOT implemented in Phase B', () => {
    expect(isProviderTypeImplemented('openai-direct')).toBe(false)
    expect(isProviderTypeImplemented('openai-compat-proxy')).toBe(false)
    expect(isProviderTypeImplemented('gemini')).toBe(false)
    expect(isProviderTypeImplemented('anthropic-bedrock')).toBe(false)
    expect(isProviderTypeImplemented('anthropic-vertex')).toBe(false)
  })
})

describe('migrateLegacyProviderSettings', () => {
  it('produces empty profile list when legacy activeMode is null', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: null },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.profiles).toEqual([])
    expect(result.settings.defaultProfileId).toBeNull()
    expect(result.credentialRenames).toEqual([])
  })

  it('preserves defaultModel when no activeMode is set', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: null, defaultModel: 'claude-opus-4-6' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.defaultModel).toBe('claude-opus-4-6')
  })

  it('migrates subscription mode into claude-subscription profile', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: 'subscription' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.profiles).toHaveLength(1)
    expect(result.settings.profiles[0]).toMatchObject({
      id: STUB_ID,
      name: 'Claude Pro/Max',
      credential: { type: 'claude-subscription' },
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(result.settings.defaultProfileId).toBe(STUB_ID)
    expect(result.credentialRenames).toEqual([
      { fromKey: legacyCredentialKey('subscription'), toKey: credentialKeyFor(STUB_ID) },
    ])
  })

  it('migrates api_key mode into anthropic-api profile', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: 'api_key' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.profiles[0]).toMatchObject({
      name: 'Anthropic API',
      credential: { type: 'anthropic-api' },
    })
  })

  it('migrates openrouter mode into anthropic-compat-proxy with preset baseUrl', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: 'openrouter' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.profiles[0]).toMatchObject({
      name: 'OpenRouter',
      credential: {
        type: 'anthropic-compat-proxy',
        baseUrl: 'https://openrouter.ai/api/v1',
        authStyle: 'bearer',
      },
    })
  })

  it('migrates custom mode into anthropic-compat-proxy with placeholder fields', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: 'custom' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.settings.profiles[0]).toMatchObject({
      name: 'Custom Proxy',
      credential: {
        type: 'anthropic-compat-proxy',
        baseUrl: '',
        authStyle: 'bearer',
      },
    })
  })

  it('is idempotent — passes through already-migrated settings unchanged', () => {
    const migrated: ProviderProfileSettings = {
      profiles: [
        {
          id: STUB_ID,
          name: 'Anthropic API',
          credential: { type: 'anthropic-api' },
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      defaultProfileId: STUB_ID,
    }
    const result = migrateLegacyProviderSettings(migrated)
    expect(result.settings).toBe(migrated)
    expect(result.credentialRenames).toEqual([])
  })

  it('handles undefined/null input gracefully (fresh install)', () => {
    const resultUndef = migrateLegacyProviderSettings(undefined)
    expect(resultUndef.settings.profiles).toEqual([])
    expect(resultUndef.settings.defaultProfileId).toBeNull()

    const resultNull = migrateLegacyProviderSettings(null)
    expect(resultNull.settings.profiles).toEqual([])
  })

  it('emits credential rename plan that matches CredentialStore key conventions', () => {
    const result = migrateLegacyProviderSettings(
      { activeMode: 'api_key' },
      { generateId: stubIdFactory, now: stubNow },
    )
    expect(result.credentialRenames).toHaveLength(1)
    expect(result.credentialRenames[0].fromKey).toBe('api_key')
    expect(result.credentialRenames[0].toKey).toBe(`credential:${STUB_ID}`)
  })
})
