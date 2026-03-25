// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
import { useAppStore } from '@/stores/appStore'
import { groupProjects } from '@shared/projectGrouping'
import type { GroupedProjects } from '@shared/types'

export function useGroupedProjects(): GroupedProjects {
  const projects = useAppStore((s) => s.projects)
  return useMemo(() => groupProjects(projects), [projects])
}
