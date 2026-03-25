// SPDX-License-Identifier: Apache-2.0

/**
 * FileViewerStarButton — self-sufficient star toggle for file viewer dialogs.
 *
 * ## Architecture (v2 — Self-Sufficient)
 *
 * The button resolves its own star context automatically:
 *   1. Explicit `starContext` prop (highest priority — for callers outside session tree)
 *   2. Ambient `SessionStarContext` via `useSessionStar()` hook
 *   3. Global project ID via Zustand store
 *
 * If NONE of the above yields a valid context, the button returns `null`.
 * This eliminates the need for callers to guard with `&& starContext &&`.
 *
 * Usage:
 *   // Inside a session — no starContext needed, auto-resolved
 *   <FileViewerStarButton filePath={filePath} content={content} />
 *
 *   // Outside a session — explicit override
 *   <FileViewerStarButton
 *     filePath={filePath}
 *     content={content}
 *     starContext={{ type: 'project', projectId }}
 *   />
 */
import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mimeTypeFromExtension } from '@shared/mimeTypes'
import { useSessionStar } from '@/components/DetailPanel/SessionPanel/FileStarButton'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import type { Artifact, FileViewerStarContext, StarArtifactInput, StarProjectFileInput } from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Hash helper ──────────────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface StarState {
  artifactId: string | null
  starred: boolean
  contentHash: string | null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FileViewerStarButtonProps {
  filePath: string
  content: string
  /**
   * Explicit star context override. When omitted, the button auto-resolves
   * from ambient SessionStarContext or the global project selector.
   */
  starContext?: FileViewerStarContext
  /**
   * Explicit metadata for in-memory content that has no real file path.
   * When provided, overrides the automatic derivation from `filePath`.
   */
  metadata?: { title: string; mimeType: string; fileExtension: string | null }
  className?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileViewerStarButton = memo(function FileViewerStarButton({
  filePath,
  content,
  starContext: explicitStarContext,
  metadata,
  className,
}: FileViewerStarButtonProps): React.JSX.Element | null {
  // ── Context resolution (self-sufficient) ──
  // Priority: explicit prop > ambient session > global project.
  const sessionCtx = useSessionStar()
  const projectId = useAppStore(selectProjectId)
  const starContext = useMemo<FileViewerStarContext | null>(() => {
    if (explicitStarContext) return explicitStarContext
    if (sessionCtx) {
      return {
        type: 'session',
        sessionId: sessionCtx.sessionId,
        issueId: sessionCtx.issueId,
        projectId: sessionCtx.projectId,
      }
    }
    if (projectId) return { type: 'project', projectId }
    return null
  }, [explicitStarContext, sessionCtx, projectId])

  // ── Star state ──
  const [state, setState] = useState<StarState>({ artifactId: null, starred: false, contentHash: null })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // On mount / dependency change: compute hash + look up existing artifact.
  useEffect(() => {
    if (!content || !starContext) return

    let cancelled = false

    sha256(content).then((hash) => {
      if (cancelled) return
      if (mountedRef.current) setState((prev) => ({ ...prev, contentHash: hash }))

      const findExisting =
        starContext.type === 'session'
          ? getAppAPI()['list-artifacts']({ sessionId: starContext.sessionId })
              .then((arts: Artifact[]) => arts.find((a) => a.contentHash === hash) ?? null)
          : getAppAPI()['list-artifacts']({ projectId: starContext.projectId })
              .then((arts: Artifact[]) =>
                arts.find((a) => a.source === 'project_file' && a.filePath === filePath) ?? null,
              )

      findExisting
        .then((match) => {
          if (cancelled || !match) return
          if (mountedRef.current) {
            setState({ artifactId: match.id, starred: match.starred, contentHash: hash })
          }
        })
        .catch(() => {})
    })

    return () => { cancelled = true }
  }, [filePath, content, starContext])

  const handleToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!content || !starContext) return

      const newStarred = !state.starred
      setState((prev) => ({ ...prev, starred: newStarred }))

      try {
        const hash = state.contentHash ?? await sha256(content)

        if (state.artifactId) {
          await getAppAPI()['update-artifact-meta'](state.artifactId, { starred: newStarred })
        } else if (starContext.type === 'session') {
          const ext = metadata?.fileExtension ?? (filePath.includes('.') ? ('.' + filePath.split('.').pop()!) : null)
          const input: StarArtifactInput = {
            kind: 'file',
            title: metadata?.title ?? filePath.split('/').pop() ?? filePath,
            mimeType: metadata?.mimeType ?? (ext ? mimeTypeFromExtension(ext) : 'text/plain'),
            filePath: filePath || null,
            fileExtension: ext,
            content,
            contentHash: hash,
            stats: { writes: 0, edits: 0 },
            sessionId: starContext.sessionId,
            issueId: starContext.issueId,
            projectId: starContext.projectId,
            starred: newStarred,
          }
          const persisted = await getAppAPI()['star-session-artifact'](input)
          if (mountedRef.current) {
            setState({ artifactId: persisted.id, starred: persisted.starred, contentHash: hash })
          }
        } else {
          const ext = metadata?.fileExtension ?? (filePath.includes('.') ? ('.' + filePath.split('.').pop()!) : null)
          const input: StarProjectFileInput = {
            filePath,
            fileExtension: ext,
            content,
            contentHash: hash,
            projectId: starContext.projectId,
            starred: newStarred,
          }
          const persisted = await getAppAPI()['star-project-file'](input)
          if (mountedRef.current) {
            setState({ artifactId: persisted.id, starred: persisted.starred, contentHash: hash })
          }
        }
      } catch {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, starred: !newStarred }))
        }
      }
    },
    [content, filePath, metadata, starContext, state],
  )

  // ── Render ──
  // No context → no star button. This is the ONLY guard.
  if (!starContext) return null

  const fileName = metadata?.title ?? filePath.split('/').pop() ?? filePath

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
