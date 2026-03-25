// SPDX-License-Identifier: Apache-2.0

/**
 * navigationActions — Cross-store navigation coordination.
 *
 * These functions wrap navigation methods from `appStore` and add
 * cross-store side effects (e.g. clearing content search state).
 *
 * Consumers should import navigation from here rather than calling
 * `useAppStore.getState().navigateToSession(...)` directly when the
 * navigation involves cross-store coordination.
 *
 * Design rationale:
 *   - appStore handles its own state transitions (project switch,
 *     tab switch, detail context, etc.) — single responsibility.
 *   - contentSearchStore is independently managed — it does NOT
 *     import appStore, and appStore does NOT import it.
 *   - This coordinator is the ONLY place that "knows" both stores
 *     need to react to a navigation event.
 */

import { useAppStore } from '@/stores/appStore'
import { useContentSearchStore } from '@/stores/contentSearchStore'

/**
 * Navigate to a session detail panel within a project.
 *
 * - Sets the project, switches to the claude tab, and opens the
 *   session in the detail panel.
 * - Clears any active content search results (cross-store coordination).
 */
export function navigateToSession(projectId: string, sessionId: string): void {
  useAppStore.getState().navigateToSession(projectId, sessionId)
  useContentSearchStore.getState().clearContentSearch()
}

/**
 * Navigate to an agent chat session within a project.
 *
 * - Sets the project, switches to the chat tab, and opens the
 *   conversation view for the given session.
 * - Clears any active content search results (cross-store coordination).
 */
export function navigateToChatSession(projectId: string, sessionId: string): void {
  useAppStore.getState().navigateToChatSession(projectId, sessionId)
  useContentSearchStore.getState().clearContentSearch()
}
