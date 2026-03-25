// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  deriveSlashExecutionContractFromItemExecutionMeta,
  extractNativeRequirementsFromContent,
  normalizeSlashExecutionContract,
} from '../../../src/shared/slashExecution'

describe('slashExecution', () => {
  it('derives evose execution contract from slash item execution meta', () => {
    const contract = deriveSlashExecutionContractFromItemExecutionMeta({
      provider: 'evose',
      app: {
        id: 'agent_github_iab8p2',
        type: 'agent',
        gatewayTool: 'evose_run_agent',
      },
    })

    expect(contract).toEqual({
      nativeRequirements: [{ capability: 'evose' }],
      providerExecution: {
        provider: 'evose',
        appId: 'agent_github_iab8p2',
        appType: 'agent',
        gatewayTool: 'evose_run_agent',
      },
    })
  })

  it('normalizes provider/native consistency', () => {
    const normalized = normalizeSlashExecutionContract({
      nativeRequirements: [],
      providerExecution: {
        provider: 'evose',
        appId: 'app-1',
        appType: 'workflow',
        gatewayTool: 'evose_run_workflow',
      },
    })

    expect(normalized.nativeRequirements).toEqual([{ capability: 'evose' }])
  })

  it('extracts deduplicated native requirements from message content', () => {
    const required = extractNativeRequirementsFromContent([
      {
        type: 'slash_command',
        name: 'evose:a',
        category: 'skill',
        label: 'A',
        execution: {
          nativeRequirements: [{ capability: 'evose' }, { capability: 'evose' }],
        },
        expandedText: 'a',
      },
      {
        type: 'slash_command',
        name: 'evose:b',
        category: 'skill',
        label: 'B',
        execution: {
          nativeRequirements: [{ capability: 'evose', tool: 'evose_run_agent' }],
        },
        expandedText: 'b',
      },
    ])

    expect(required).toEqual([
      { capability: 'evose' },
      { capability: 'evose', tool: 'evose_run_agent' },
    ])
  })
})
