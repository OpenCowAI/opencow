// SPDX-License-Identifier: Apache-2.0

/**
 * Shared config for session inline draft confirmation cards.
 */
export interface SessionDraftFooterConfig {
  projectId?: string | null
  issueCreationMode?: 'standalone' | 'subissue'
  defaultParentIssueId?: string | null
  source?: 'fenced-output' | 'lifecycle-operation'
}
