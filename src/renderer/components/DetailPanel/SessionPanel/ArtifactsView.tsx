// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useCallback, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, GitBranch, Globe, Download, Clock, Loader2, X, Star, FileCode2 } from 'lucide-react'
import { Badge } from '../../ui/badge'
import { Dialog } from '../../ui/Dialog'
import { cn } from '@/lib/utils'
import { MermaidBlock } from '../../ui/MermaidBlock'
import { renderMermaid, resolveThemeColors } from '@/lib/mermaidRenderer'
import { safeSlice } from '@shared/unicode'
import type { ExtractedArtifact } from './artifactUtils'
import { formatRelativeTime } from './artifactUtils'
import { NotePopoverTrigger } from './NotesView/NotePopoverTrigger'
import { getAppAPI } from '@/windowAPI'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'
import { useArtifactViewerContext, getArtifactStableId } from './ArtifactViewerContext'

// Direct import — MarkdownContent is used in ArtifactCard list items where
// lazy + Suspense would cause per-card "Loading..." flicker during scrolling.
import { MarkdownContent } from '../../ui/MarkdownContent'

// Lazy-load Dialog-level components — only loaded when the user opens a viewer.
// This is the correct granularity for lazy(): user-triggered, single-instance views.
const MarkdownPreviewWithToc = lazy(() =>
  import('../../ui/MarkdownPreviewWithToc').then((m) => ({ default: m.MarkdownPreviewWithToc }))
)
const CodeViewer = lazy(() =>
  import('../../ui/code-viewer').then((m) => ({ default: m.CodeViewer }))
)

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'preview' | 'source'

// ─── ArtifactsView ───────────────────────────────────────────────────────────

interface ArtifactsViewProps {
  artifacts: ExtractedArtifact[]
}

/**
 * Scrollable card grid for all artifact kinds collected during a session.
 *
 * Star button is ALWAYS visible. On click:
 * - Already persisted → toggle star via `update-artifact-meta`
 * - Not persisted → Eager Persist via `star-session-artifact` (persist + star in one shot)
 */
export const ArtifactsView = memo(function ArtifactsView({
  artifacts,
}: ArtifactsViewProps): React.JSX.Element {
  const { showViewer, starMap, toggleStar } = useArtifactViewerContext()

  // Empty state
  if (artifacts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))] px-4">
        <FileCode2 className="w-8 h-8 opacity-30" aria-hidden="true" />
        <p className="text-sm font-medium">No artifacts yet</p>
        <p className="text-xs text-center leading-relaxed opacity-70">
          Files, diagrams, and other outputs created during this session will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 flex flex-wrap gap-2.5 content-start">
        {artifacts.map((artifact) => (
          <ArtifactCard
            key={artifact.contentHash}
            artifact={artifact}
            starred={starMap.get(artifact.contentHash)?.starred ?? false}
            onOpen={showViewer}
            onToggleStar={toggleStar}
          />
        ))}
      </div>
    </div>
  )
})

// ─── ArtifactCard ────────────────────────────────────────────────────────────

interface ArtifactCardProps {
  artifact: ExtractedArtifact
  starred: boolean
  onOpen: (id: string) => void
  onToggleStar: (artifact: ExtractedArtifact) => void
}

/**
 * Compact card showing artifact metadata and preview.
 * Star button is ALWAYS visible — supports Eager Persist on first star.
 */
const ArtifactCard = memo(function ArtifactCard({
  artifact,
  starred,
  onOpen,
  onToggleStar,
}: ArtifactCardProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { kind, title, mimeType, filePath, fileExtension, lastModifiedAt, content, contentHash, stats } = artifact
  const isDiagram = kind === 'diagram'
  const isMarkdown = mimeType === 'text/markdown'
  const isHtml = mimeType === 'text/html'

  // Use stable ID (filePath preferred, contentHash fallback) for viewer lookup
  const stableId = getArtifactStableId(artifact)
  const handleClick = useCallback(() => onOpen(stableId), [onOpen, stableId])
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(stableId) }
    },
    [onOpen, stableId],
  )

  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation() // Don't trigger card open
      onToggleStar(artifact)
    },
    [onToggleStar, artifact],
  )

  const Icon = isDiagram ? GitBranch : isHtml ? Globe : FileText

  return (
    <div
      className={cn(
        'w-56 rounded-xl border bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] shadow-sm',
        'cursor-pointer hover:border-[hsl(var(--primary)/0.5)] transition-colors group',
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${title}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[hsl(var(--border)/0.5)]">
        <Icon className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate flex-1">{title}</span>

        {/* Star toggle — always visible */}
        <button
          onClick={handleStarClick}
          className={cn(
            'p-0.5 rounded transition-colors shrink-0',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
            starred
              ? 'text-amber-400 hover:text-amber-500'
              : 'text-[hsl(var(--muted-foreground)/0.4)] hover:text-amber-400 opacity-0 group-hover:opacity-100',
          )}
          aria-label={starred ? `${t('artifacts.unstar')} ${title}` : `${t('artifacts.star')} ${title}`}
        >
          <Star className={cn('w-3 h-3', starred && 'fill-current')} aria-hidden="true" />
        </button>

        {/* Kind / extension badge */}
        {isDiagram ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4 shrink-0">mermaid</Badge>
        ) : fileExtension ? (
          <Badge variant="secondary" className="px-1 py-0 text-[9px] leading-3.5 shrink-0">{fileExtension}</Badge>
        ) : null}
      </div>

      {/* Body */}
      <div className="px-2.5 pt-1.5 space-y-1">
        {/* File path (files only) */}
        {filePath && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] truncate font-mono" title={filePath}>
            {filePath}
          </p>
        )}

        {/* Meta: time + stats */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">
            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
            {formatRelativeTime(lastModifiedAt)}
          </span>
          {(stats.writes > 0 || stats.edits > 0) && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
              {stats.writes > 0 && `${stats.writes}w`}
              {stats.writes > 0 && stats.edits > 0 && ' · '}
              {stats.edits > 0 && `${stats.edits}e`}
            </Badge>
          )}
        </div>
      </div>

      {/* Content preview — adapts to artifact kind */}
      {content ? (
        isHtml ? (
          /* HTML — CSS-scaled iframe thumbnail (self-contained, no gradient) */
          <div className="relative mt-1 mx-2.5 mb-1.5 overflow-hidden rounded-sm pointer-events-none" aria-label="Content preview">
            <div className="relative aspect-[16/10]" style={{ contain: 'strict' }}>
              <iframe
                srcDoc={content}
                sandbox=""
                title={`HTML thumbnail: ${title}`}
                className="absolute top-0 left-0 w-[200%] h-[200%] border-0 bg-white"
                style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}
                tabIndex={-1}
              />
            </div>
          </div>
        ) : (
          <div className="relative mt-1">
            <div className="px-2.5 py-1.5 max-h-24 overflow-hidden" aria-label={isDiagram ? 'Diagram preview' : 'Content preview'}>
              {isDiagram ? (
                <DiagramThumbnail code={content} />
              ) : isMarkdown ? (
                <MarkdownContent content={content} />
              ) : (
                /* Code / plain text snippet for non-markdown files */
                <pre className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-all leading-relaxed">
                  {safeSlice(content, 0, 500)}
                </pre>
              )}
            </div>
            <div
              className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-[hsl(var(--card))] to-transparent"
              aria-hidden="true"
            />
          </div>
        )
      ) : (
        <div className="px-2.5 py-1.5 mt-1">
          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] italic">
            Content unavailable (edited only)
          </p>
        </div>
      )}

      {/* Hover hint */}
      <div className="px-2.5 py-1 text-[10px] text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 transition-opacity">
        Click to preview
      </div>
    </div>
  )
})

// ─── DiagramThumbnail ────────────────────────────────────────────────────────

/**
 * Inline SVG thumbnail for diagram cards.
 * Renders a scaled-down version of MermaidBlock (without interactive features).
 */
function DiagramThumbnail({ code }: { code: string }): React.JSX.Element {
  return (
    <div className="pointer-events-none [&>div]:my-0 transform scale-[0.6] origin-top-left w-[167%]">
      <MermaidBlock code={code} />
    </div>
  )
}

// ─── ArtifactViewerDialog ────────────────────────────────────────────────────

interface ArtifactViewerDialogProps {
  artifact: ExtractedArtifact
  open: boolean
  starred: boolean
  onToggleStar: (artifact: ExtractedArtifact) => void
  onClose: () => void
}

/** Map MIME type to CodeViewer language string. */
function languageFromMimeType(mimeType: string): string {
  if (mimeType === 'text/markdown') return 'markdown'
  if (mimeType === 'text/typescript') return 'typescript'
  if (mimeType === 'text/javascript') return 'javascript'
  if (mimeType === 'application/json') return 'json'
  if (mimeType === 'text/yaml') return 'yaml'
  if (mimeType === 'text/html') return 'html'
  if (mimeType === 'text/css') return 'css'
  if (mimeType === 'text/x-python') return 'python'
  if (mimeType === 'text/x-rust') return 'rust'
  if (mimeType === 'text/x-go') return 'go'
  if (mimeType === 'text/x-java') return 'java'
  if (mimeType === 'text/x-ruby') return 'ruby'
  if (mimeType === 'text/x-shellscript') return 'bash'
  if (mimeType === 'text/x-sql') return 'sql'
  if (mimeType === 'text/x-c') return 'c'
  if (mimeType === 'text/x-cpp') return 'cpp'
  if (mimeType === 'text/x-mermaid') return 'mermaid'
  return 'text'
}

export const ArtifactViewerDialog = memo(function ArtifactViewerDialog({
  artifact,
  open,
  starred,
  onToggleStar,
  onClose,
}: ArtifactViewerDialogProps): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { kind, title, mimeType, filePath, content, lastModifiedAt, stats } = artifact
  const hasContent = content != null && content.length > 0
  const isDiagram = kind === 'diagram'
  const isMarkdown = mimeType === 'text/markdown'
  const isHtml = mimeType === 'text/html'
  const lineCount = hasContent ? content!.split('\n').length : 0
  const language = languageFromMimeType(mimeType)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')

  // Rich preview is available for markdown, mermaid, and html; other types go straight to code viewer
  const hasRichPreview = isDiagram || isMarkdown || isHtml

  const handleDownload = useCallback(() => {
    if (!hasContent) return

    const baseName = isDiagram ? title.toLowerCase().replace(/\s+/g, '-') : title

    if (isDiagram && viewMode === 'preview') {
      // Preview mode for diagrams → download rendered SVG
      try {
        const svg = renderMermaid(content!, resolveThemeColors())
        getAppAPI()['download-file'](`${baseName}.svg`, svg)
      } catch {
        // Fallback to source download if render fails
        getAppAPI()['download-file'](`${baseName}.mmd`, content!)
      }
    } else if (isDiagram) {
      // Source mode for diagrams → download .mmd source
      getAppAPI()['download-file'](`${baseName}.mmd`, content!)
    } else {
      // File artifacts → download with original name
      getAppAPI()['download-file'](baseName, content!)
    }
  }, [title, content, hasContent, isDiagram, viewMode])

  return (
    <Dialog open={open} onClose={onClose} title={title} size="3xl" className="!max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {isDiagram
              ? <GitBranch className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              : isHtml
              ? <Globe className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
              : <FileText className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            }
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{title}</h3>
            {/* Star toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStar(artifact) }}
              className={cn(
                'p-0.5 rounded transition-colors shrink-0',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                starred
                  ? 'text-amber-400 hover:text-amber-500'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-amber-400',
              )}
              aria-label={starred ? `${t('artifacts.unstar')} ${title}` : `${t('artifacts.star')} ${title}`}
              title={starred ? t('artifacts.unstar') : t('artifacts.star')}
            >
              <Star className={cn('w-3.5 h-3.5', starred && 'fill-current')} aria-hidden="true" />
            </button>
            {hasContent && (
              <button
                onClick={handleDownload}
                className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={`Download ${isDiagram ? (viewMode === 'preview' ? 'SVG' : 'source') : title}`}
                title={isDiagram ? (viewMode === 'preview' ? 'Download SVG' : 'Download .mmd source') : `Download ${title}`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {filePath ?? title}
            {hasContent && (
              <>
                <span className="mx-1.5">&middot;</span>
                {language}
                <span className="mx-1.5">&middot;</span>
                {lineCount.toLocaleString()} lines
                <span className="mx-1.5">&middot;</span>
                {content!.length.toLocaleString()} chars
              </>
            )}
            <span className="mx-1.5">&middot;</span>
            {formatRelativeTime(lastModifiedAt)}
            {(stats.writes > 0 || stats.edits > 0) && (
              <>
                <span className="mx-1.5">&middot;</span>
                {stats.writes > 0 && `${stats.writes} write${stats.writes > 1 ? 's' : ''}`}
                {stats.writes > 0 && stats.edits > 0 && ', '}
                {stats.edits > 0 && `${stats.edits} edit${stats.edits > 1 ? 's' : ''}`}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {/* Preview / Source toggle — only for kinds with rich preview */}
          {hasContent && hasRichPreview && (
            <div className="flex rounded-md border border-[hsl(var(--border))] overflow-hidden" role="tablist" aria-label="View mode">
              <button
                role="tab"
                aria-selected={viewMode === 'preview'}
                onClick={() => setViewMode('preview')}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                  viewMode === 'preview'
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
              >
                Preview
              </button>
              <button
                role="tab"
                aria-selected={viewMode === 'source'}
                onClick={() => setViewMode('source')}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
                  viewMode === 'source'
                    ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)]',
                )}
              >
                Source
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label="Close viewer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content area — polymorphic by kind + MIME type */}
      <div className="relative">
        {!hasContent ? (
          <div className="h-[82vh] flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
            <FileText className="w-6 h-6 opacity-30" aria-hidden="true" />
            <p className="text-xs text-center leading-relaxed">
              Full content unavailable — this artifact was only edited (no Write operation recorded).
            </p>
          </div>
        ) : viewMode === 'preview' && isDiagram ? (
          <div className="h-[82vh] overflow-y-auto px-6 py-4 flex items-start justify-center">
            <MermaidBlock code={content!} />
          </div>
        ) : viewMode === 'preview' && isMarkdown ? (
          <Suspense fallback={<LoadingFallback label="Loading preview..." />}>
            <MarkdownPreviewWithToc content={content!} className="h-[82vh]" />
          </Suspense>
        ) : viewMode === 'preview' && isHtml ? (
          <iframe
            srcDoc={wrapHtmlForSafePreview(content!)}
            sandbox="allow-scripts"
            title={`HTML preview: ${title}`}
            className="w-full h-[82vh] border-0 bg-white"
          />
        ) : (
          /* Source view or code-only (non-markdown/non-diagram) files */
          <div className="h-[82vh]">
            <Suspense fallback={<LoadingFallback label="Loading editor..." />}>
              <CodeViewer content={content!} language={language} />
            </Suspense>
          </div>
        )}
        {/* Floating Note trigger */}
        <NotePopoverTrigger sourceFilePath={filePath ?? title} />
      </div>
    </Dialog>
  )
})

// ─── Shared fallback ─────────────────────────────────────────────────────────

function LoadingFallback({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center h-32 text-xs text-[hsl(var(--muted-foreground))]">
      <Loader2 className="w-4 h-4 mr-1.5 motion-safe:animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}
