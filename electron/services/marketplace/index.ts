// SPDX-License-Identifier: Apache-2.0

/**
 * Skills Marketplace module — re-exports for clean imports.
 */

export { MarketplaceService } from './service'
export type { MarketplaceProvider, MarketplaceSettings, MarketplaceInstallParams } from './types'
export { DEFAULT_MARKETPLACE_SETTINGS } from './types'
export { SkillsShAdapter } from './adapters/skillsSh'
export { ClawHubAdapter } from './adapters/clawhub'
export { GitHubAdapter } from './adapters/github'
