// SPDX-License-Identifier: Apache-2.0

/**
 * ArtifactsSummaryBlock — compact horizontal quick-preview strip shown at the
 * bottom of the Console after an agent reply completes.
 *
 * Motivation: when a session produces several artifacts the user would normally
 * have to scroll back through the message list to find them.  This block
 * surfaces all session artifacts as small clickable chips directly below the
 * message list, so they are always a single click away.
 *
 * Clicking a chip opens the full ArtifactViewerDialog (same viewer used on the
 * Artifacts tab).  A "View all" link switches to the Artifacts tab for the
 * grid-style overview.
 */
import { memo, useCallback } from 'react'
import { FileText, GitBranch, Layers, ChevronRight, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '../../ui/badge'
import type { ExtractedArtifact } from './artifactUtils'
import { useArtifactViewerContext, getArtifactStableId } from './ArtifactViewerContext'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ArtifactsSummaryBlockProps {
  /** All artifacts produced during the session — shown as compact chips. */
  artifacts: ExtractedArtifact[]
  /** Called when the user clicks "View all" — typically switches to the Artifacts tab. */
  onViewAll?: () => void
}

// ─── ArtifactsSummaryBlock ───────────────────────────────────────────────────

export const ArtifactsSummaryBlock = memo(function ArtifactsSummaryBlock({
  artifacts,
  onViewAll,
}: ArtifactsSummaryBlockProps): React.JSX.Element | null {
  const { showViewer, starMap, toggleStar } = useArtifactViewerContext()

  // Nothing to show
  if (artifacts.length === 0) return null

  return (
    <div
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 pt-2 pb-2.5 mb-1 pip-enter"
      aria-label="Artifacts quick preview"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
          <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Artifacts</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
            {artifacts.length}
          </Badge>
        </div>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className={cn(
              'flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground))]',
              'hover:text-[hsl(var(--primary))] transition-colors rounded px-1',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            )}
            aria-label="View all artifacts"
          >
            View all
            <ChevronRight className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Horizontal scrollable chips */}
      <div
        className="flex gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
        aria-label="Artifact list"
      >
        {artifacts.map((artifact) => (
          <ArtifactChip
            key={artifact.contentHash}
            artifact={artifact}
            starred={starMap.get(artifact.contentHash)?.starred ?? false}
            onClick={() => showViewer(getArtifactStableId(artifact))}
            onToggleStar={() => toggleStar(artifact)}
          />
        ))}
      </div>
    </div>
  )
})

// ─── ArtifactChip ─────────────────────────────────────────────────────────────

interface ArtifactChipProps {
  artifact: ExtractedArtifact
  starred: boolean
  onClick: () => void
  onToggleStar: () => void
}

/**
 * Compact pill-style chip representing a single artifact.
 * Shows: icon · filename · type badge · star toggle
 */
const ArtifactChip = memo(function ArtifactChip({
  artifact,
  starred,
  onClick,
  onToggleStar,
}: ArtifactChipProps): React.JSX.Element {
  const isDiagram = artifact.kind === 'diagram'
  const Icon = isDiagram ? GitBranch : FileText

  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleStar()
    },
    [onToggleStar],
  )

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 shrink-0',
        'px-2 py-1 rounded-lg border border-[hsl(var(--border)/0.5)] bg-[hsl(var(--card))]',
        'cursor-pointer select-none',
        'hover:border-[hsl(var(--primary)/0.5)] transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
      )}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Open ${artifact.title}`}
    >
      {/* Type icon */}
      <Icon
        className="w-3 h-3 shrink-0 text-[hsl(var(--muted-foreground))]"
        aria-hidden="true"
      />

      {/* Filename */}
      <span className="text-[11px] font-medium text-[hsl(var(--foreground))] max-w-[140px] truncate leading-4">
        {artifact.title}
      </span>

      {/* Type badge */}
      {isDiagram ? (
        <Badge variant="secondary" className="px-1 py-0 text-[9px] leading-3.5 shrink-0">
          mermaid
        </Badge>
      ) : artifact.fileExtension ? (
        <Badge variant="secondary" className="px-1 py-0 text-[9px] leading-3.5 shrink-0">
          {artifact.fileExtension}
        </Badge>
      ) : null}

      {/* Star toggle */}
      <button
        onClick={handleStarClick}
        className={cn(
          'p-0.5 rounded transition-colors shrink-0',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
          starred
            ? 'text-amber-400 hover:text-amber-500'
            : 'text-[hsl(var(--muted-foreground)/0.3)] hover:text-amber-400 opacity-0 group-hover:opacity-100',
        )}
        aria-label={starred ? `Unstar ${artifact.title}` : `Star ${artifact.title}`}
        title={starred ? 'Unstar' : 'Star'}
      >
        <Star className={cn('w-2.5 h-2.5', starred && 'fill-current')} aria-hidden="true" />
      </button>
    </div>
  )
})
