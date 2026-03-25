// SPDX-License-Identifier: Apache-2.0

/**
 * Marketplace Provider abstraction layer.
 *
 * Each Skills Market (skills.sh, clawhub.ai, etc.) is wrapped as a
 * `MarketplaceProvider` — a uniform interface that MarketplaceService
 * orchestrates for search, preview, and installation.
 */

import type {
  MarketplaceId,
  ManagedCapabilityCategory,
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
  MarketProviderInfo,
  MarketProviderStatus,
  MarketSkillInfo,
  MarketInstallPreview,
} from '../../../src/shared/types'

// ─── Provider Response ──────────────────────────────────────

/**
 * Structured search response from a provider.
 *
 * Adapter encodes its own status (ok / needs-key / error / rate-limited)
 * rather than throwing exceptions — the service layer never has to guess.
 */
export interface MarketplaceSearchResponse {
  status: MarketProviderStatus
  results: MarketSearchResult
}

// ─── Provider Interface ─────────────────────────────────────

/** Uniform interface for any Skills Marketplace backend. */
export interface MarketplaceProvider {
  /** Unique marketplace identifier. */
  readonly id: MarketplaceId
  /** Human-readable name shown in UI. */
  readonly displayName: string
  /** SVG icon name or data-uri. */
  readonly icon: string
  /** Marketplace website URL. */
  readonly url: string

  /** Search skills by query. Never throws — errors are encoded in status. */
  search(params: MarketSearchParams): Promise<MarketplaceSearchResponse>

  /** Browse curated lists (trending, popular, recent, featured). */
  browse(params: MarketBrowseParams): Promise<MarketSearchResult>

  /** Fetch full skill detail (SKILL.md content + metadata). */
  getDetail(slug: string): Promise<MarketSkillDetail>

  /**
   * Download a skill bundle to a local temporary directory.
   * The directory will contain SKILL.md and optional scripts/references/assets.
   */
  download(slug: string, targetDir: string): Promise<void>

  /**
   * Apply marketplace settings.
   * Each adapter picks only the fields it needs from the full settings object.
   * Called once on init and whenever the user changes preferences.
   */
  configure(settings: MarketplaceSettings): void

  /** Check whether this provider is reachable (network connectivity). */
  checkAvailability(): Promise<boolean>

  /** Build a provider descriptor for UI display. */
  toInfo(available: boolean): MarketProviderInfo

  /**
   * Probe repository for structured capabilities (skills, commands, agents, etc.).
   *
   * Providers that support multi-capability discovery should implement this method.
   * When present, `MarketplaceService.analyze()` delegates to this method instead
   * of using hardcoded probing logic.
   *
   * @param slug - Marketplace-specific identifier (e.g. "owner/repo")
   * @returns Capability preview, or undefined if probing is not supported
   */
  probeCapabilities?(slug: string): Promise<MarketInstallPreview>
}

// ─── Service Dependencies ────────────────────────────────────

/** Item shape passed through the import pipeline. */
export interface MarketplaceImportItem {
  name: string
  category: ManagedCapabilityCategory
  description: string
  sourcePath: string
  sourceType: 'marketplace'
  alreadyImported: false
  sourceScope: 'global' | 'project'
  isBundle: boolean
  marketInfo: MarketSkillInfo
}

/** Import pipeline result. */
export interface MarketplaceImportResult {
  imported: string[]
  skipped: string[]
  errors: Array<{ name: string; error: string }>
}

/**
 * Dependency interface for skill import — injected into MarketplaceService.
 *
 * Decouples marketplace from CapabilityCenter's concrete implementation,
 * making the service testable and the dependency explicit.
 */
export interface MarketplaceImporter {
  /** Import marketplace items through the capability pipeline. */
  importItems(
    items: MarketplaceImportItem[],
    target: { scope: 'global' | 'project'; projectId?: string },
  ): Promise<MarketplaceImportResult>
}

// ─── Install ─────────────────────────────────────────────────

/** Parameters for installing a skill from marketplace. */
export interface MarketplaceInstallParams {
  slug: string
  marketplaceId: MarketplaceId
  scope: 'global' | 'project'
  projectId?: string
  /** Namespace prefix for multi-capability packages (e.g. "superpowers"). */
  namespacePrefix?: string
}

// ─── Configuration ──────────────────────────────────────────

/** Per-provider configuration stored in OpenCow Settings. */
export interface MarketplaceSettings {
  /** Master switch for the entire marketplace feature. */
  enabled: boolean
  /** GitHub PAT — raises rate limits for skills.sh detail/download. */
  githubToken?: string
  /** ClawHub Bearer token (optional, for install telemetry). */
  clawhubToken?: string
  /** Provider IDs that should be queried. */
  enabledProviders: MarketplaceId[]
  /** Search-result cache TTL in minutes (default 10). */
  cacheMinutes: number
  /** Default install scope (consumed by renderer UI, not by service layer). */
  defaultScope: 'global' | 'project'
}

export const DEFAULT_MARKETPLACE_SETTINGS: MarketplaceSettings = {
  enabled: true,
  enabledProviders: ['skills.sh', 'github'],
  cacheMinutes: 10,
  defaultScope: 'global',
}
