// SPDX-License-Identifier: Apache-2.0

import type { SessionWorkspaceInput, UserConfigurableWorkspaceInput } from '../../../src/shared/types'

/**
 * Resolve a user-configurable workspace selector to session workspace input.
 *
 * In user settings, only `project` and `global` are allowed.
 */
export function resolveUserWorkspaceBinding(workspace: UserConfigurableWorkspaceInput | undefined): SessionWorkspaceInput {
  if (!workspace) return { scope: 'global' }
  if (workspace.scope === 'project') {
    const projectId = workspace.projectId.trim()
    return projectId ? { scope: 'project', projectId } : { scope: 'global' }
  }
  return { scope: 'global' }
}
