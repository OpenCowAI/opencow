// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext, useMemo } from 'react'

/**
 * Ambient project scope for capability resolution.
 *
 * Components within a `ProjectScopeProvider` subtree automatically receive
 * the project identity, enabling hooks like `useSlashCommands` and
 * `useCapabilitySnapshot` to load project-scoped capabilities without prop drilling.
 *
 * When no provider is present, both fields default to `undefined`,
 * which gracefully falls back to global-only capabilities.
 */
export interface ProjectScopeContextValue {
  projectPath?: string
  projectId?: string
}

const ProjectScopeContext = createContext<ProjectScopeContextValue>({})

export function ProjectScopeProvider({
  projectPath,
  projectId,
  children,
}: {
  projectPath?: string
  projectId?: string
  children: React.ReactNode
}): React.JSX.Element {
  const value = useMemo<ProjectScopeContextValue>(
    () => ({ projectPath, projectId }),
    [projectPath, projectId],
  )

  return (
    <ProjectScopeContext.Provider value={value}>
      {children}
    </ProjectScopeContext.Provider>
  )
}

/**
 * Read the ambient project scope.
 *
 * Safe to call outside a provider — returns `{ projectPath: undefined, projectId: undefined }`.
 */
export function useProjectScope(): ProjectScopeContextValue {
  return useContext(ProjectScopeContext)
}
