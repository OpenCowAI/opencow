// SPDX-License-Identifier: Apache-2.0

import type { ManagedCapabilityCategory } from '@shared/types'
import type { EngineGovernanceDriver, GovernanceOperation } from './engineGovernanceDriver'

const SUPPORTED_CATEGORIES = new Set<ManagedCapabilityCategory>(['skill', 'mcp-server'])

export class CodexGovernanceDriver implements EngineGovernanceDriver {
  readonly engineKind = 'codex' as const

  constructor(private readonly impl: Omit<EngineGovernanceDriver, 'engineKind' | 'supports'>) {}

  supports(category: ManagedCapabilityCategory, op: GovernanceOperation): boolean {
    if (!SUPPORTED_CATEGORIES.has(category)) return false
    return op === 'discover' || op === 'import' || op === 'publish' || op === 'unpublish' || op === 'detect-drift'
  }

  discover: EngineGovernanceDriver['discover'] = (params) => this.impl.discover(params)

  importItem: EngineGovernanceDriver['importItem'] = (params) => this.impl.importItem(params)

  publish: EngineGovernanceDriver['publish'] = (params) => this.impl.publish(params)

  unpublish: EngineGovernanceDriver['unpublish'] = (params) => this.impl.unpublish(params)

  detectDrift: EngineGovernanceDriver['detectDrift'] = (params) => this.impl.detectDrift(params)
}
