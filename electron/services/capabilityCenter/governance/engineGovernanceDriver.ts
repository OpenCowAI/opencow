// SPDX-License-Identifier: Apache-2.0

import type { ManagedCapabilityCategory } from '@shared/types'
import type { CapabilityStore } from '../capabilityStore'
import type { StateRepository, DistributionRecord } from '../stateRepository'
import type { ImportableItem, ImportTarget } from '../importPipeline'
import type { CapabilityDistributionTargetType } from '../distributionTargets'
import type { DriftReport } from '../distributionPipeline'

export type GovernanceOperation =
  | 'discover'
  | 'import'
  | 'publish'
  | 'unpublish'
  | 'detect-drift'

export interface EngineGovernanceDriver {
  readonly engineKind: 'claude'

  supports(category: ManagedCapabilityCategory, op: GovernanceOperation): boolean

  discover(params: {
    projectPath?: string
    category?: ManagedCapabilityCategory
  }): Promise<ImportableItem[]>

  importItem(params: {
    item: ImportableItem
    target: ImportTarget
    store: CapabilityStore
    stateRepo: StateRepository
  }): Promise<void>

  publish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: CapabilityDistributionTargetType
    projectPath?: string
    store: CapabilityStore
    stateRepo: StateRepository
    strategy?: 'copy' | 'symlink'
  }): Promise<void>

  unpublish(params: {
    category: ManagedCapabilityCategory
    name: string
    target: CapabilityDistributionTargetType
    projectPath?: string
    stateRepo: StateRepository
  }): Promise<void>

  detectDrift(params: {
    distributions: DistributionRecord[]
    store: CapabilityStore
  }): Promise<DriftReport[]>
}
