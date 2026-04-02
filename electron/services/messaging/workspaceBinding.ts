// SPDX-License-Identifier: Apache-2.0

import type { SessionWorkspaceInput } from '../../../src/shared/types'

/**
 * Resolve bot/runtime workspace bindings to the unified session workspace input.
 *
 * Precedence:
 * 1) projectId  -> project workspace (resolved to canonical path by orchestrator)
 * 2) cwd path   -> explicit custom-path workspace
 * 3) fallback   -> global workspace (user home)
 */
export function resolveWorkspaceBinding(params: {
  projectId?: string | null
  cwd?: string | null
}): SessionWorkspaceInput {
  const projectId = params.projectId?.trim()
  if (projectId) {
    return { scope: 'project', projectId }
  }

  const cwd = params.cwd?.trim()
  if (cwd) {
    return { scope: 'custom-path', cwd }
  }

  return { scope: 'global' }
}
