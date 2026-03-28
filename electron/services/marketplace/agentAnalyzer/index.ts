// SPDX-License-Identifier: Apache-2.0

/**
 * Agent-First Package Analysis module.
 *
 * Exports the public API for repo analysis via AI Agent.
 * Internal components (ManifestValidator, ManifestCache, RepoAnalyzerCapability)
 * are implementation details — only RepoAnalyzer and types are public.
 */

export { RepoAnalyzer } from './repoAnalyzer'
export type { PreparedAnalysisSession } from './repoAnalyzer'
export { RepoAnalyzerCapability } from './repoAnalyzerCapability'
export type {
  AgentManifest,
  AgentCapability,
  ValidatedManifest,
  ValidatedCapability,
  RejectedCapability,
  RepoAnalysisParams,
  RepoAnalysisResult,
  ManifestCacheKey,
  StructuredRepo,
  AnalysisPhase,
  AnalysisProgress,
} from './types'
export { RepoStructurer } from './repoStructurer'
