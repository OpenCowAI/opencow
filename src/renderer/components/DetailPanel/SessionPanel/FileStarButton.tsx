// SPDX-License-Identifier: Apache-2.0

/**
 * FileStarButton — self-contained star toggle for file content in viewer dialogs.
 *
 * Reads session context from a lightweight React Context (provided by SessionPanel)
 * so it can call `star-session-artifact` without threading props through every layer.
 *
 * Usage:
 *   <FileStarButton filePath="/foo/bar.md" content="..." />
 */
import { createContext, useContext, memo, useState, useCallback, useEffect, useRef } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mimeTypeFromExtension } from '@shared/mimeTypes'
import type { Artifact, StarArtifactInput } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── SessionStarContext ──────────────────────────────────────────────────────

export interface SessionStarContextValue {
  sessionId: string
  issueId: string | null
  projectId: string | null
}

const SessionStarCtx = createContext<SessionStarContextValue | null>(null)

export const SessionStarProvider = SessionStarCtx.Provider

export function useSessionStar(): SessionStarContextValue | null {
  return useContext(SessionStarCtx)
}

// ─── Hash helper ─────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── FileStarButton ─────────────────────────────────────────────────────────

interface FileStarButtonProps {
  /** Absolute or relative file path (used to derive extension, mimeType, title). */
  filePath: string
  /** File content — used to compute contentHash for artifact dedup. */
  content: string
  className?: string
}

interface StarState {
  artifactId: string | null
  starred: boolean
  contentHash: string | null
}

export const FileStarButton = memo(function FileStarButton({
  filePath,
  content,
  className,
}: FileStarButtonProps): React.JSX.Element | null {
  const ctx = useSessionStar()
  const [state, setState] = useState<StarState>({ artifactId: null, starred: false, contentHash: null })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // On mount: compute hash + check if already starred
  useEffect(() => {
    if (!ctx?.sessionId || !content) return

    let cancelled = false
    sha256(content).then((hash) => {
      if (cancelled) return
      setState((prev) => ({ ...prev, contentHash: hash }))

      getAppAPI()['list-artifacts']({ sessionId: ctx.sessionId })
        .then((artifacts: Artifact[]) => {
          if (cancelled) return
          const match = artifacts.find((a) => a.contentHash === hash)
          if (match) {
            setState({ artifactId: match.id, starred: match.starred, contentHash: hash })
          }
        })
        .catch(() => {})
    })

    return () => { cancelled = true }
  }, [ctx?.sessionId, content])

  const handleToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!ctx?.sessionId || !content) return

      const newStarred = !state.starred

      // Optimistic update
      setState((prev) => ({ ...prev, starred: newStarred }))

      try {
        const hash = state.contentHash ?? await sha256(content)

        if (state.artifactId) {
          // Already persisted → simple toggle
          await getAppAPI()['update-artifact-meta'](state.artifactId, { starred: newStarred })
        } else {
          // Eager Persist + Star
          const ext = filePath.includes('.') ? ('.' + filePath.split('.').pop()!) : null
          const input: StarArtifactInput = {
            kind: 'file',
            title: filePath.split('/').pop() ?? filePath,
            mimeType: ext ? mimeTypeFromExtension(ext) : 'text/plain',
            filePath,
            fileExtension: ext,
            content,
            contentHash: hash,
            stats: { writes: 0, edits: 0 },
            sessionId: ctx.sessionId,
            issueId: ctx.issueId,
            projectId: ctx.projectId,
            starred: newStarred,
          }
          const persisted = await getAppAPI()['star-session-artifact'](input)
          if (mountedRef.current) {
            setState({ artifactId: persisted.id, starred: persisted.starred, contentHash: hash })
          }
        }
      } catch {
        // Revert on failure
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, starred: !newStarred }))
        }
      }
    },
    [ctx, content, filePath, state],
  )

  // Don't render if no session context (e.g. outside SessionPanel)
  if (!ctx) return null

  const fileName = filePath.split('/').pop() ?? filePath

  return (
    <button
      onClick={handleToggle}
      className={cn(
        'p-0.5 rounded transition-colors shrink-0',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        state.starred
          ? 'text-amber-400 hover:text-amber-500'
          : 'text-[hsl(var(--muted-foreground))] hover:text-amber-400',
        className,
      )}
      aria-label={state.starred ? `Unstar ${fileName}` : `Star ${fileName}`}
      title={state.starred ? 'Unstar' : 'Star'}
    >
      <Star className={cn('w-3.5 h-3.5', state.starred && 'fill-current')} aria-hidden="true" />
    </button>
  )
})
