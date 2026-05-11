// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useEffect, useCallback, lazy, Suspense } from 'react'
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
import { useAppStore, selectProjectPath } from '@/stores/appStore'
import { useInView } from '@/hooks/useInView'

// Direct import — MarkdownContent is used in ArtifactCard list items where
// lazy + Suspense would cause per-card "Loading..." flicker during scrolling.
import { MarkdownContent } from '../../ui/MarkdownContent'

// MarkdownPreviewWithToc is eager: every heavy transitive dep it needs
// (`react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-raw`,
// `MarkdownContent` itself) is already eagerly imported above for the
// in-card preview path, so splitting it into a lazy chunk saved only a
// few KB of its own component code while costing a full chunk-load
// round-trip on the very first dialog open — long enough that the
// Suspense "Loading preview…" fallback would persist until the dialog
// was already closing.  Preloading via `useEffect` could narrow the
// gap but not close it.
import { MarkdownPreviewWithToc } from '../../ui/MarkdownPreviewWithToc'

// CodeViewer stays lazy: it pulls in Monaco, which is a genuine multi-MB
// chunk that pays for itself only when the user actually inspects source.
// We expose the module factory so the dialog can warm the chunk in
// parallel with its disk-read.  Bundlers deduplicate in-flight import
// promises, so calling this twice resolves to the same module instance.
const loadCodeViewer = (): Promise<typeof import('../../ui/code-viewer')> =>
  import('../../ui/code-viewer')

const CodeViewer = lazy(() =>
  loadCodeViewer().then((m) => ({ default: m.CodeViewer }))
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
  const { kind, title, mimeType, filePath, fileExtension, lastModifiedAt, content: recordedContent, contentHash, stats } = artifact
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

  // Disk-first preview fallback for edit-only artifacts.
  //
  // `recordedContent` is the in-memory Write snapshot extracted from
  // session messages.  Files that Claude only Edited (no Write op) have
  // `recordedContent === null`, which used to render the "Content
  // unavailable" placeholder even though the file is sitting on disk.
  //
  // We mirror the `StarredArtifactCard` strategy: gate the disk read on
  // `useInView` so an artifact list with many cards doesn't fan out IPC
  // reads on mount, and keep the read truncated to match the bounded
  // preview budget.
  const projectPath = useAppStore(selectProjectPath)
  const { ref: previewRef, inView } = useInView()
  const [livePreview, setLivePreview] = useState<string | null>(null)
  const hasRecordedContent = recordedContent != null && recordedContent.length > 0

  useEffect(() => {
    if (!inView) return
    if (hasRecordedContent) return
    if (!filePath || !projectPath) return
    let cancelled = false
    void (async () => {
      const result = await getAppAPI()['read-file-content'](projectPath, filePath)
      if (cancelled || !result.ok) return
      // Truncate to match the bounded preview render budget — the full
      // file content is fetched again (uncached) when the user opens the
      // viewer dialog, where it's actually needed.
      setLivePreview(result.data.content.slice(0, 2000))
    })()
    return () => {
      cancelled = true
    }
  }, [inView, hasRecordedContent, filePath, projectPath])

  const content = hasRecordedContent ? recordedContent : livePreview
  const hasContent = content != null && content.length > 0

  return (
    <div
      className={cn(
        // Card visual + hover treatment mirrors `StarredArtifactCard` so the
        // two artifact surfaces feel identical: subtle border, rounded-2xl,
        // lift + soft shadow on hover (the lift replaces the old "Click to
        // preview" text hint, so the affordance lives entirely in motion).
        'group relative w-56 cursor-pointer overflow-hidden',
        'rounded-2xl border border-[hsl(var(--border)/0.55)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
        // `min-h` aligns card bottoms within the flex-wrap grid even when
        // previews differ in height.
        'min-h-[220px]',
        'transition-all duration-200',
        'hover:-translate-y-[5px] hover:shadow-[0_4px_12px_0_hsl(var(--foreground)/0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
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

      {/* Content preview — adapts to artifact kind.
          The container is observed by `useInView`; heavy children
          (iframe / Mermaid / Markdown parse / disk fallback fetch)
          only mount once the card is on screen, keeping mount-time work
          bounded for long artifact lists. */}
      <div ref={previewRef}>
        {hasContent ? (
          isHtml ? (
            /* HTML — CSS-scaled iframe thumbnail (self-contained, no gradient) */
            <div className="relative mt-1 mx-2.5 mb-1.5 overflow-hidden rounded-sm pointer-events-none" aria-label="Content preview">
              <div className="relative aspect-[16/10]" style={{ contain: 'strict' }}>
                {inView && (
                  <iframe
                    srcDoc={content!}
                    sandbox=""
                    title={`HTML thumbnail: ${title}`}
                    className="absolute top-0 left-0 w-[200%] h-[200%] border-0 bg-white"
                    style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}
                    tabIndex={-1}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="relative mt-1">
              <div
                className="artifact-card-preview px-2.5 py-1.5 max-h-24 overflow-hidden"
                aria-label={isDiagram ? 'Diagram preview' : 'Content preview'}
              >
                {inView && (
                  isDiagram ? (
                    <DiagramThumbnail code={content!} />
                  ) : isMarkdown ? (
                    <MarkdownContent content={content!} />
                  ) : (
                    /* Code / plain text snippet for non-markdown files */
                    <pre className="text-[9px] font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-all leading-snug">
                      {safeSlice(content!, 0, 500)}
                    </pre>
                  )
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
  const { kind, title, mimeType, filePath, content: recordedContent, lastModifiedAt, stats } = artifact
  const projectPath = useAppStore(selectProjectPath)

  // Disk-first content resolution.
  //
  // Resolution order:
  //   1. Live file on disk (`read-file-content` under the current project's
  //      path). This is the freshest source — captures edits made after the
  //      original Write was recorded.
  //   2. Recorded in-memory snapshot (`artifact.content`, from the latest
  //      Write tool_use). Used when the file no longer exists on disk
  //      (moved / deleted) or when the artifact has no filePath
  //      (e.g. in-memory `gen_html`).
  //
  // Without (1) an artifact that was only edited (no Write op recorded)
  // would surface "content unavailable" even though its file is sitting
  // right there on disk.
  const [liveContent, setLiveContent] = useState<string | null>(null)
  const [diskLoading, setDiskLoading] = useState(false)

  // Warm the lazy CodeViewer (Monaco) chunk in parallel with the disk
  // read.  The Source-view branch only mounts after content arrives, so
  // without this warm-up the multi-MB Monaco chunk would start loading
  // only when the user flips to Source, stacking its cost on top of the
  // disk read.
  useEffect(() => {
    void loadCodeViewer()
  }, [])

  useEffect(() => {
    if (!filePath || !projectPath) {
      setLiveContent(null)
      setDiskLoading(false)
      return
    }
    let cancelled = false
    setDiskLoading(true)
    setLiveContent(null)
    ;(async () => {
      try {
        const result = await getAppAPI()['read-file-content'](projectPath, filePath)
        if (cancelled) return
        if (result.ok) setLiveContent(result.data.content)
      } finally {
        if (!cancelled) setDiskLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePath, projectPath, artifact.contentHash])

  const content = liveContent ?? recordedContent
  const hasContent = content != null && content.length > 0
  // Spinner only when we have no in-memory snapshot to show in the meantime —
  // otherwise we render the recorded content immediately and silently swap to
  // disk once the read resolves.
  const showLoading = diskLoading && recordedContent == null && !hasContent
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
        {showLoading ? (
          <div className="h-[82vh] flex items-center justify-center">
            <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
          </div>
        ) : !hasContent ? (
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
          <MarkdownPreviewWithToc content={content!} className="h-[82vh]" />
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
