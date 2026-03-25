// SPDX-License-Identifier: Apache-2.0

/**
 * useArtifactStarMap — shared star-state management for session artifacts.
 *
 * Provides a Map<contentHash, StarState> that tracks which artifacts are starred,
 * seeded from persisted data and updated optimistically on toggle.
 *
 * Used by ArtifactsView and ArtifactsSummaryBlock via ArtifactViewerContext
 * to eliminate duplicated star logic.
 */
import { useState, useCallback, useEffect } from 'react'
import type { ExtractedArtifact } from './artifactUtils'
import type { Artifact } from '@shared/types'
import { getAppAPI } from '@/windowAPI'
import { createLogger } from '@/lib/logger'

const log = createLogger('ArtifactStarMap')

// ─── Types ───────────────────────────────────────────────────────────────────

/** Persisted star state for a single artifact. */
export interface StarState {
  artifactId: string
  starred: boolean
}

interface UseArtifactStarMapOptions {
  sessionId: string
  issueId: string | null
  projectId: string | null
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useArtifactStarMap({ sessionId, issueId, projectId }: UseArtifactStarMapOptions) {
  const [starMap, setStarMap] = useState<Map<string, StarState>>(new Map())

  // Seed star state from persisted artifacts on mount / sessionId change
  useEffect(() => {
    if (!sessionId) return
    getAppAPI()['list-artifacts']({ sessionId })
      .then((persisted: Artifact[]) => {
        const map = new Map<string, StarState>()
        for (const a of persisted) {
          map.set(a.contentHash, { artifactId: a.id, starred: a.starred })
        }
        setStarMap(map)
      })
      .catch(() => { /* not yet persisted — OK */ })
  }, [sessionId])

  const toggleStar = useCallback(
    async (artifact: ExtractedArtifact) => {
      if (!sessionId) return

      const existing = starMap.get(artifact.contentHash)
      const newStarred = !(existing?.starred ?? false)

      // Optimistic update
      setStarMap((prev) => {
        const next = new Map(prev)
        next.set(artifact.contentHash, {
          artifactId: existing?.artifactId ?? '',
          starred: newStarred,
        })
        return next
      })

      try {
        if (existing?.artifactId) {
          // Already persisted -> simple toggle
          await getAppAPI()['update-artifact-meta'](existing.artifactId, { starred: newStarred })
        } else {
          // Not persisted -> Eager Persist + Star
          const persisted = await getAppAPI()['star-session-artifact']({
            kind: artifact.kind,
            title: artifact.title,
            mimeType: artifact.mimeType,
            filePath: artifact.filePath,
            fileExtension: artifact.fileExtension,
            content: artifact.content,
            contentHash: artifact.contentHash,
            stats: artifact.stats,
            sessionId,
            issueId,
            projectId,
            starred: newStarred,
          })
          setStarMap((prev) => {
            const next = new Map(prev)
            next.set(artifact.contentHash, { artifactId: persisted.id, starred: persisted.starred })
            return next
          })
        }
      } catch (err) {
        log.error('Star toggle failed:', err)
        // Revert
        setStarMap((prev) => {
          const next = new Map(prev)
          if (existing) {
            next.set(artifact.contentHash, existing)
          } else {
            next.delete(artifact.contentHash)
          }
          return next
        })
      }
    },
    [sessionId, issueId, projectId, starMap],
  )

  return { starMap, toggleStar }
}
