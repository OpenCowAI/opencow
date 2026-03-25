// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { deriveEvoseRelayKey } from '../../../src/shared/evoseNames'

describe('deriveEvoseRelayKey', () => {
  it('returns toolName:appId for local tool name', () => {
    expect(deriveEvoseRelayKey('evose_run_agent', '92226822732779520'))
      .toBe('evose_run_agent:92226822732779520')
  })

  it('strips MCP prefix from fully-qualified tool name', () => {
    expect(deriveEvoseRelayKey('mcp__opencow-capabilities__evose_run_agent', '92226822732779520'))
      .toBe('evose_run_agent:92226822732779520')
  })

  it('trims whitespace from appId', () => {
    expect(deriveEvoseRelayKey('evose_run_agent', '  app-123  '))
      .toBe('evose_run_agent:app-123')
  })

  it('returns just toolName when appId is empty', () => {
    expect(deriveEvoseRelayKey('evose_run_agent', ''))
      .toBe('evose_run_agent')
  })

  it('returns just toolName when appId is whitespace-only', () => {
    expect(deriveEvoseRelayKey('evose_run_agent', '   '))
      .toBe('evose_run_agent')
  })

  it('produces consistent keys for registration and emission sides', () => {
    // Registration side uses block.name (MCP-qualified) + block.input.app_id
    const registrationKey = deriveEvoseRelayKey(
      'mcp__opencow-capabilities__evose_run_agent',
      '92226822732779520',
    )
    // Emission side uses local tool name + args.app_id
    const emissionKey = deriveEvoseRelayKey(
      'evose_run_agent',
      '92226822732779520',
    )
    expect(registrationKey).toBe(emissionKey)
  })
})
