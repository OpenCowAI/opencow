// SPDX-License-Identifier: Apache-2.0

import type { ManagedCapabilityCategory } from '@shared/types'
import type { EngineGovernanceDriver, GovernanceOperation } from './engineGovernanceDriver'

export class ClaudeGovernanceDriver implements EngineGovernanceDriver {
  readonly engineKind = 'claude' as const

  constructor(private readonly impl: Omit<EngineGovernanceDriver, 'engineKind' | 'supports'>) {}

  supports(_category: ManagedCapabilityCategory, _op: GovernanceOperation): boolean {
    return true
  }

  discover: EngineGovernanceDriver['discover'] = (params) => this.impl.discover(params)

  importItem: EngineGovernanceDriver['importItem'] = (params) => this.impl.importItem(params)

  publish: EngineGovernanceDriver['publish'] = (params) => this.impl.publish(params)

  unpublish: EngineGovernanceDriver['unpublish'] = (params) => this.impl.unpublish(params)

  detectDrift: EngineGovernanceDriver['detectDrift'] = (params) => this.impl.detectDrift(params)
}
