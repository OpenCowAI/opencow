// SPDX-License-Identifier: Apache-2.0

/**
 * Agent-First Package Analysis — Type Definitions.
 *
 * These types define the data contracts between the RepoAnalyzer (Agent session),
 * ManifestValidator (safety gate), RepoStructurer (adapter), and the existing
 * PackageService install pipeline.
 *
 * The Agent submits an `AgentManifest` via the `submit_manifest` tool.
 * ManifestValidator produces a `ValidatedManifest`.
 * RepoStructurer consumes the validated manifest and produces a standard directory layout.
 */

import type { ManagedCapabilityCategory, MarketAnalysisPhase } from '../../../../src/shared/types'

// ─── Agent Output ──────────────────────────────────────────────────────

/** Single capability identified by the analysis Agent. */
export interface AgentCapability {
  /** Capability name in kebab-case (e.g. "spec-driven-development") */
  readonly name: string
  /** Capability category */
  readonly category: ManagedCapabilityCategory
  /** Relative path to the source file within the repo */
  readonly sourcePath: string
  /** One-line description */
  readonly description: string
  /** Agent's confidence in this classification */
  readonly confidence: 'high' | 'medium' | 'low'
}

/**
 * Structured manifest submitted by the analysis Agent.
 *
 * This is the Agent's "answer" to "what capabilities does this repo contain?"
 * Every path must point to an existing file (validated by the submit_manifest tool).
 */
export interface AgentManifest {
  /** Suggested namespace prefix for the package */
  readonly packageName: string
  /** Discovered capabilities */
  readonly capabilities: readonly AgentCapability[]
  /** Agent's reasoning for its analysis decisions */
  readonly reasoning: string
}

// ─── Validation ────────────────────────────────────────────────────────

/** A capability that passed validation. */
export interface ValidatedCapability extends AgentCapability {
  readonly status: 'valid'
}

/** A capability that failed validation, with reasons. */
export interface RejectedCapability extends AgentCapability {
  readonly status: 'rejected'
  readonly issues: readonly string[]
}

/**
 * Manifest after validation — separates valid from rejected capabilities.
 *
 * Only `capabilities` (valid ones) are presented to the user for confirmation.
 * `rejected` items are logged for diagnostics but not shown in the install UI.
 */
export interface ValidatedManifest {
  /** Sanitised package name (lowercase, kebab-case) */
  readonly packageName: string
  /** Capabilities that passed all validation checks */
  readonly capabilities: readonly ValidatedCapability[]
  /** Capabilities that failed validation (logged, not installed) */
  readonly rejected: readonly RejectedCapability[]
  /** Agent's reasoning (passed through for UI display) */
  readonly reasoning: string
}

// ─── Analysis Session ──────────────────────────────────────────────────

/** Cache key for manifest results — same repo@version = same analysis. */
export interface ManifestCacheKey {
  readonly slug: string
  readonly version: string
  readonly commitSha?: string
}

/**
 * Phases emitted by RepoAnalyzer via the onProgress callback.
 *
 * Subset of MarketAnalysisPhase — the Agent layer only emits agent:* phases
 * and 'cancelled'. The 'downloading' and 'validating' phases are emitted by
 * MarketplaceService (one layer above).
 */
export type AnalysisPhase = Extract<
  MarketAnalysisPhase,
  'agent:started' | 'agent:reading-files' | 'agent:analyzing' | 'agent:submitting' | 'agent:done' | 'cancelled'
>

/** Progress event emitted during Agent analysis. */
export interface AnalysisProgress {
  readonly phase: AnalysisPhase
  /** Human-readable description of current activity */
  readonly detail?: string
  /** Name of the tool the Agent is currently using */
  readonly toolName?: string
}

/** Input parameters for RepoAnalyzer.analyze(). */
export interface RepoAnalysisParams {
  /** Local path to the downloaded and extracted repository */
  readonly repoDir: string
  /** Cache key for deduplication */
  readonly cacheKey: ManifestCacheKey
  /** Marketplace metadata for context enrichment */
  readonly marketDetail: {
    readonly name: string
    readonly description: string
    readonly author?: string
    readonly repoUrl?: string
  }
  /**
   * Optional progress callback — invoked during Agent analysis with
   * phase transitions and tool activity. Used by MarketplaceService
   * to emit DataBus events for real-time UI updates.
   */
  readonly onProgress?: (progress: AnalysisProgress) => void
  /**
   * Abort signal for cancellation support.
   * When aborted, the SDK stream is closed and analysis terminates gracefully.
   */
  readonly signal?: AbortSignal
}

/** Result of a repo analysis — includes source provenance. */
export interface RepoAnalysisResult {
  /** Whether the result came from cache or a fresh Agent session */
  readonly source: 'cache' | 'agent'
  /**
   * Validated manifest, or null if Agent determined repo has no installable capabilities.
   * When null, `reasoning` in the manifest explains why.
   */
  readonly manifest: ValidatedManifest | null
}

// ─── Repo Structurer ───────────────────────────────────────────────────

/** Output of RepoStructurer.prepare() — ready for PackageService.install(). */
export interface StructuredRepo {
  /** Path to the staging directory with standard layout */
  readonly stagingDir: string
  /** Capabilities map for PackageManifest */
  readonly capabilities: Partial<Record<ManagedCapabilityCategory, string[]>>
}
