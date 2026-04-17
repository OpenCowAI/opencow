// SPDX-License-Identifier: Apache-2.0

/**
 * Shared config for session inline draft confirmation cards.
 */
export interface InlineFencedDraftFooterConfig {
  strategy: 'inline-fenced-draft'
  projectId?: string | null
  issueCreationMode?: 'standalone' | 'subissue'
  defaultParentIssueId?: string | null
}

export interface LifecycleToolResultOnlyConfig {
  strategy: 'lifecycle-tool-result-only'
}

export type SessionDraftFooterConfig =
  | InlineFencedDraftFooterConfig
  | LifecycleToolResultOnlyConfig
