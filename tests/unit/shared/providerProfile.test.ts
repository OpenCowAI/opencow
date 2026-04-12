// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  credentialKeyFor,
  generateProviderProfileId,
  isProviderTypeImplemented,
} from '../../../src/shared/providerProfile'

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
  it('flags Anthropic-native + OpenAI-family + Gemini as implemented', () => {
    expect(isProviderTypeImplemented('claude-subscription')).toBe(true)
    expect(isProviderTypeImplemented('anthropic-api')).toBe(true)
    expect(isProviderTypeImplemented('anthropic-compat-proxy')).toBe(true)
    expect(isProviderTypeImplemented('openai-direct')).toBe(true)
    expect(isProviderTypeImplemented('openai-compat-proxy')).toBe(true)
    expect(isProviderTypeImplemented('gemini')).toBe(true)
  })

  it('flags cloud-SDK types (Bedrock / Vertex) as NOT yet implemented', () => {
    expect(isProviderTypeImplemented('anthropic-bedrock')).toBe(false)
    expect(isProviderTypeImplemented('anthropic-vertex')).toBe(false)
  })
})

describe('credentialKeyFor', () => {
  it('prefixes with `credential:` for CredentialStore addressing', () => {
    const id = generateProviderProfileId()
    expect(credentialKeyFor(id)).toBe(`credential:${id}`)
  })
})
