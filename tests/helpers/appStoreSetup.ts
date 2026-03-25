// SPDX-License-Identifier: Apache-2.0

/**
 * Test helpers for appStore and issueStore setup and teardown.
 *
 * Centralizes the normalized issue setup pattern (issueById + issueIds)
 * and issue detail cache population.
 *
 * After Phase 4 extraction, issue data lives in issueStore while
 * selectedIssueId stays in appStore (part of _projectStates).
 */

import { useAppStore } from '../../src/renderer/stores/appStore'
import { useIssueStore } from '../../src/renderer/stores/issueStore'
import type { Issue, IssueSummary } from '../../src/shared/types'

/**
 * Populate the normalized issue index (issueById + issueIds) in issueStore.
 *
 * Mirrors the production `normalizeIssues()` logic so tests
 * don't manually construct Record + array in every test case.
 */
export function setAppStoreIssues(issues: IssueSummary[]): void {
  const issueById: Record<string, IssueSummary> = {}
  const issueIds: string[] = []
  for (const issue of issues) {
    issueById[issue.id] = issue
    issueIds.push(issue.id)
  }
  useIssueStore.setState({ issueById, issueIds })
}

/**
 * Populate the issue detail cache with full Issue objects in issueStore.
 *
 * Used when tests render detail-level components (IssueDetailView,
 * SessionPanel with issue binding) that read from `issueDetailCache`.
 */
export function setAppStoreIssueDetailCache(issues: Issue[]): void {
  const cache = new Map<string, Issue>()
  for (const issue of issues) {
    cache.set(issue.id, issue)
  }
  useIssueStore.setState({ issueDetailCache: cache })
}

/**
 * Reset issueStore to a clean state.
 *
 * Should be called in `beforeEach` for tests that interact with issue data.
 */
export function resetIssueStore(): void {
  useIssueStore.setState({
    issueById: {},
    issueIds: [],
    issueDetailCache: new Map(),
    childIssuesCache: {},
    customLabels: [],
    issueViews: [],
    viewIssueCounts: {},
  })
}
