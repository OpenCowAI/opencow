// SPDX-License-Identifier: Apache-2.0

/**
 * SessionContextBar — displays git branch, worktree status, and working directory
 * for the session linked to an issue.
 *
 * Design:
 *   - Pure display component — no store subscriptions here.
 *   - Receives executionContext from its hook (useExecutionContextForIssue).
 *   - Renders nothing when there's no execution context (no session, or context not yet resolved).
 *   - Styling matches the existing meta strip in IssueDetailView (text-[10px], muted foreground).
 */

import { GitBranch, GitFork, FolderOpen } from 'lucide-react'
import type { SessionExecutionContext } from '@shared/types'
import { useExecutionContextForIssue } from '../../hooks/useExecutionContextForIssue'

interface SessionContextBarProps {
  issueId: string
  viewingArchivedSessionId: string | null
  /** Project root path — used to determine if cwd should be displayed (only when different from project). */
  projectPath: string | null
}

/**
 * Shorten a file path for display.
 * Replaces home directory with ~ and truncates long segments.
 */
function shortenPath(path: string): string {
  // Replace home dir with ~
  const home = typeof window !== 'undefined'
    ? (window as unknown as Record<string, string>).__HOME_DIR__
    : undefined
  if (home && path.startsWith(home)) {
    return '~' + path.slice(home.length)
  }
  // Fallback: if path starts with /Users/xxx or /home/xxx, shorten
  const homeMatch = path.match(/^(\/(?:Users|home)\/[^/]+)(.*)$/)
  if (homeMatch) {
    return '~' + homeMatch[2]
  }
  return path
}

/**
 * Wrapper component that subscribes to the execution context via hook
 * and renders the visual bar. This separation keeps the subscription
 * isolated — IssueDetailView doesn't need to know about managedSessions.
 */
export function SessionContextBar({ issueId, viewingArchivedSessionId, projectPath }: SessionContextBarProps): React.JSX.Element | null {
  const ctx = useExecutionContextForIssue(issueId, viewingArchivedSessionId)
  if (!ctx) return null
  return <SessionContextBarView ctx={ctx} projectPath={projectPath} />
}

interface SessionContextBarViewProps {
  ctx: SessionExecutionContext
  projectPath: string | null
}

/**
 * Pure display component — renders the git info bar.
 * Separated from the hook wrapper for clarity and testability.
 */
function SessionContextBarView({ ctx, projectPath }: SessionContextBarViewProps): React.JSX.Element {
  const { cwd, gitBranch, isDetached, isWorktree } = ctx

  // Only show working directory when it differs from project root (worktree or external dir)
  const showCwd = isWorktree || (projectPath != null && cwd !== projectPath)

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
      {/* Git Branch */}
      {gitBranch && (
        <span
          className="inline-flex items-center gap-1 font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--muted)/0.5)]"
          title={isDetached ? `${gitBranch} (detached HEAD)` : gitBranch}
        >
          <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate max-w-[180px]">
            {gitBranch}
            {isDetached && <span className="opacity-60"> (detached)</span>}
          </span>
        </span>
      )}

      {/* Detached HEAD without branch name — show just the indicator */}
      {!gitBranch && isDetached && (
        <span className="inline-flex items-center gap-1 font-mono px-1.5 py-0.5 rounded bg-[hsl(var(--muted)/0.5)]">
          <GitBranch className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="opacity-60">detached HEAD</span>
        </span>
      )}

      {/* Worktree badge */}
      {isWorktree && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]">
          <GitFork className="w-3 h-3 shrink-0" aria-hidden="true" />
          worktree
        </span>
      )}

      {/* Working directory — only shown when relevant (worktree or non-project cwd) */}
      {showCwd && cwd && (
        <span
          className="inline-flex items-center gap-1 truncate max-w-[200px]"
          title={cwd}
        >
          <FolderOpen className="w-3 h-3 shrink-0" aria-hidden="true" />
          {shortenPath(cwd)}
        </span>
      )}
    </div>
  )
}
