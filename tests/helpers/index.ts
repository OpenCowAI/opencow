// SPDX-License-Identifier: Apache-2.0

/**
 * Test helpers barrel — single import path for test infrastructure.
 *
 * Usage:
 * ```ts
 * import {
 *   makeManagedSession, makeIssue, makeIssueSummary,
 *   resetCommandStore, setCommandStoreSessions,
 *   setAppStoreIssues, setAppStoreIssueDetailCache, resetIssueStore,
 * } from '../../helpers'
 * ```
 */

// ─── Test Data Factories ──────────────────────────────────────────────
export { makeManagedSession, makeIssue, makeIssueSummary } from './factories'

// ─── Store Setup (commandStore) ───────────────────────────────────────
export { resetCommandStore, setCommandStoreSessions } from './commandStoreSetup'

// ─── Store Setup (appStore + issueStore) ─────────────────────────────
export { setAppStoreIssues, setAppStoreIssueDetailCache, resetIssueStore } from './appStoreSetup'

// ─── Database ─────────────────────────────────────────────────────────
// testDb.ts is NOT re-exported here because it imports `better-sqlite3`
// (a native Node module) which breaks jsdom-based component tests.
// Database tests should import directly: `import { createTestDb } from '../../helpers/testDb'`
