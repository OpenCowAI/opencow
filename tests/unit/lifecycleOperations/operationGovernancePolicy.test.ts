// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { OperationGovernancePolicy } from '../../../electron/services/lifecycleOperations/operationGovernancePolicy'

describe('OperationGovernancePolicy', () => {
  const policy = new OperationGovernancePolicy()

  it('defaults to required when proposal requests required', () => {
    const mode = policy.resolveConfirmationMode({
      proposal: {
        entity: 'issue',
        action: 'create',
        normalizedPayload: {},
        confirmationMode: 'required',
      },
      noConfirmDetection: {
        explicitNoConfirm: true,
        confidence: 'high',
        evidence: '直接执行',
      },
    })

    expect(mode).toBe('required')
  })

  it('allows auto_if_user_explicit only when detector is high-confidence positive', () => {
    const mode = policy.resolveConfirmationMode({
      proposal: {
        entity: 'schedule',
        action: 'create',
        normalizedPayload: {},
        confirmationMode: 'auto_if_user_explicit',
      },
      noConfirmDetection: {
        explicitNoConfirm: true,
        confidence: 'high',
        evidence: 'skip confirmation',
      },
    })

    expect(mode).toBe('auto_if_user_explicit')
  })

  it('falls back to required when auto mode is requested but confidence is low', () => {
    const mode = policy.resolveConfirmationMode({
      proposal: {
        entity: 'schedule',
        action: 'update',
        normalizedPayload: {},
        confirmationMode: 'auto_if_user_explicit',
      },
      noConfirmDetection: {
        explicitNoConfirm: false,
        confidence: 'low',
        evidence: null,
      },
    })

    expect(mode).toBe('required')
  })

  it('maps legacy draft confirmationMode to required', () => {
    const mode = policy.resolveConfirmationMode({
      proposal: {
        entity: 'schedule',
        action: 'create',
        normalizedPayload: {},
        confirmationMode: 'draft' as unknown as 'required',
      },
      noConfirmDetection: {
        explicitNoConfirm: true,
        confidence: 'high',
        evidence: '无需确认',
      },
    })

    expect(mode).toBe('required')
  })
})
