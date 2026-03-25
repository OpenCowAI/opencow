// SPDX-License-Identifier: Apache-2.0

/**
 * ProjectListResultCard — rich card for list_projects tool results.
 *
 * Renders a compact project list with current-project highlighting,
 * pin indicators, and archive status.
 */

import { FolderOpen, Pin } from 'lucide-react'
import { CardShell } from './CardShell'

// ─── Data types ─────────────────────────────────────────────────────────────

export interface ProjectListData {
  total?: number
  currentProjectId?: string | null
  projects?: ProjectSummary[]
}

export interface ProjectSummary {
  id?: string
  name?: string
  canonicalPath?: string
  pinOrder?: number | null
  isArchived?: boolean
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/** Parse raw JSON string into ProjectListData. Stable reference for RESULT_CARD_REGISTRY. */
export function parseProjectListData(raw: string): ProjectListData {
  return JSON.parse(raw) as ProjectListData
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ProjectListResultCardProps {
  data: ProjectListData
}

export function ProjectListResultCard({ data: d }: ProjectListResultCardProps): React.JSX.Element {
  const projects = d.projects ?? []
  const total = d.total ?? projects.length
  const currentId = d.currentProjectId

  if (projects.length === 0) {
    return (
      <CardShell maxWidth="sm">
        <div className="px-3 py-2.5">
          <span className="text-xs text-[hsl(var(--muted-foreground)/0.6)] italic">
            No projects found
          </span>
        </div>
      </CardShell>
    )
  }

  return (
    <CardShell maxWidth="sm">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border)/0.3)]">
        <span className="text-xs font-medium text-[hsl(var(--foreground))]">
          Projects
        </span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)] tabular-nums">
          {total} total
        </span>
      </div>

      {/* ── Project rows ─────────────────────────────────────────────── */}
      <div className="divide-y divide-[hsl(var(--border)/0.15)]">
        {projects.map((project, i) => {
          const isCurrent = currentId != null && project.id === currentId
          const isPinned = project.pinOrder != null && project.pinOrder >= 0
          const isArchived = !!project.isArchived

          return (
            <div
              key={project.id ?? i}
              className={`flex items-center gap-2 px-3 py-1.5 ${isArchived ? 'opacity-50' : ''}`}
            >
              <FolderOpen
                className={`w-3.5 h-3.5 shrink-0 ${
                  isCurrent
                    ? 'text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))]'
                }`}
              />
              <span
                className={`flex-1 min-w-0 text-xs truncate ${
                  isCurrent
                    ? 'text-[hsl(var(--foreground))] font-medium'
                    : 'text-[hsl(var(--foreground))]'
                }`}
              >
                {project.name ?? 'Unnamed'}
              </span>
              {isPinned && (
                <Pin className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground)/0.4)] rotate-45" />
              )}
              {isCurrent && (
                <span className="shrink-0 text-[10px] text-[hsl(var(--primary))]">
                  current
                </span>
              )}
              {isArchived && (
                <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
                  archived
                </span>
              )}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}
