// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, FileText, Globe, GitBranch, Download, Clock, Loader2, X, ChevronRight, CircleDot } from 'lucide-react'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import { useArtifactsStore } from '@/stores/artifactsStore'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import { safeSlice } from '@shared/unicode'
import { resolveRenderer } from '@shared/mimeTypes'
import { renderMermaid, resolveThemeColors } from '@/lib/mermaidRenderer'
import { MermaidBlock } from '@/components/ui/MermaidBlock'
import { formatRelativeTime } from '@/components/DetailPanel/SessionPanel/artifactUtils'
import type { Artifact, FileViewerStarContext } from '@shared/types'
import { IssuePreviewOverlay } from './IssuePreviewOverlay'
import { getAppAPI } from '@/windowAPI'
import { useDialogState } from '@/hooks/useModalAnimation'
import { wrapHtmlForSafePreview } from '@/lib/htmlSandbox'
import { FileViewerStarButton } from '@/components/ui/FileViewerStarButton'

// Lazy-load heavy rendering components
const MarkdownContent = lazy(() =>
  import('@/components/ui/MarkdownContent').then((m) => ({ default: m.MarkdownContent }))
)
const MarkdownPreviewWithToc = lazy(() =>
  import('@/components/ui/MarkdownPreviewWithToc').then((m) => ({ default: m.MarkdownPreviewWithToc }))
)
const CodeViewer = lazy(() =>
  import('@/components/ui/code-viewer').then((m) => ({ default: m.CodeViewer }))
)

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewMode = 'preview' | 'source'

interface ArtifactGroup {
  issueId: string | null
  issueTitle: string
  artifacts: Artifact[]
}

// ─── StarredArtifactsView ───────────────────────────────────────────────────

export const StarredArtifactsView = memo(function StarredArtifactsView(): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const selectedProjectId = useAppStore(selectProjectId)
  // ── Reactive state ──
  const starredArtifacts = useArtifactsStore((s) => s.starredArtifacts)
  const issueById = useIssueStore((s) => s.issueById)

  const viewer = useDialogState<Artifact>()
  const [previewIssueId, setPreviewIssueId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load on mount and when project filter changes.
  // Actions are accessed via getState() — they are not reactive and must not
  // appear in useEffect dependency arrays (stable ref, but signals reactivity).
  useEffect(() => {
    setLoading(true)
    useArtifactsStore.getState().loadStarredArtifacts(selectedProjectId ?? undefined)
      .finally(() => setLoading(false))
  }, [selectedProjectId])

  // Group artifacts by issue, sorted by starredAt descending within each group
  const groups = useMemo((): ArtifactGroup[] => {
    const map = new Map<string, Artifact[]>()

    for (const artifact of starredArtifacts) {
      const key = artifact.issueId ?? '__ungrouped__'
      const existing = map.get(key) ?? []
      existing.push(artifact)
      map.set(key, existing)
    }

    const result: ArtifactGroup[] = []
    for (const [key, artifacts] of map) {
      // Sort within group: starred_at descending (most recent first)
      artifacts.sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0))

      if (key === '__ungrouped__') {
        result.push({ issueId: null, issueTitle: t('starred.ungrouped'), artifacts })
      } else {
        const issue = issueById[key]
        result.push({
          issueId: key,
          issueTitle: issue?.title ?? t('starred.unknownIssue'),
          artifacts,
        })
      }
    }

    // Sort groups: by most-recently-starred artifact, ungrouped last
    return result.sort((a, b) => {
      if (!a.issueId && b.issueId) return 1
      if (a.issueId && !b.issueId) return -1
      const aLatest = a.artifacts[0]?.starredAt ?? 0
      const bLatest = b.artifacts[0]?.starredAt ?? 0
      return bLatest - aLatest
    })
  }, [starredArtifacts, issueById])

  const handleOpenArtifact = viewer.show
  const handleClose = viewer.close

  const handleNavigateToIssue = useCallback((issueId: string) => {
    setPreviewIssueId(issueId)
  }, [])

  const handleUnstar = useCallback(async (id: string) => {
    const { toggleArtifactStar, loadStarredArtifacts } = useArtifactsStore.getState()
    await toggleArtifactStar(id, false)
    // Reload to refresh the list
    await loadStarredArtifacts(selectedProjectId ?? undefined)
  }, [selectedProjectId])

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]" />
      </div>
    )
  }

  // Empty state
  if (starredArtifacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))] px-8">
        <Star className="w-10 h-10 opacity-20" aria-hidden="true" />
        <p className="text-sm font-medium">{t('starred.noStarred')}</p>
        <p className="text-xs text-center leading-relaxed opacity-70 max-w-[280px]">
          {t('starred.noStarredDesc')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-5">
        {groups.map((group) => (
          <ArtifactGroupSection
            key={group.issueId ?? '__ungrouped__'}
            group={group}
            onOpenArtifact={handleOpenArtifact}
            onNavigateToIssue={handleNavigateToIssue}
            onUnstar={handleUnstar}
          />
        ))}
      </div>

      {/* Viewer Dialog */}
      {viewer.data && (
        <StarredArtifactViewerDialog
          artifact={viewer.data}
          open={viewer.open}
          onClose={viewer.close}
        />
      )}

      {/* Issue Detail Preview Overlay */}
      {previewIssueId && (
        <IssuePreviewOverlay
          issueId={previewIssueId}
          onClose={() => setPreviewIssueId(null)}
        />
      )}
    </div>
  )
})

// ─── ArtifactGroupSection ───────────────────────────────────────────────────

interface ArtifactGroupSectionProps {
  group: ArtifactGroup
  onOpenArtifact: (artifact: Artifact) => void
  onNavigateToIssue: (issueId: string) => void
  onUnstar: (id: string) => void
}

const ArtifactGroupSection = memo(function ArtifactGroupSection({
  group,
  onOpenArtifact,
  onNavigateToIssue,
  onUnstar,
}: ArtifactGroupSectionProps): React.JSX.Element {
  return (
    <div>
      {/* Group Header */}
      <div className="flex items-center gap-2 mb-2">
        {group.issueId ? (
          <button
            onClick={() => onNavigateToIssue(group.issueId!)}
            className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] transition-colors group"
          >
            <CircleDot className="w-3.5 h-3.5 text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--primary))]" aria-hidden="true" />
            <span className="truncate max-w-[300px]">{group.issueTitle}</span>
            <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            {group.issueTitle}
          </span>
        )}
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
          {group.artifacts.length}
        </Badge>
      </div>

      {/* Artifact Cards */}
      <div className="flex flex-wrap gap-2.5">
        {group.artifacts.map((artifact) => (
          <StarredArtifactCard
            key={artifact.id}
            artifact={artifact}
            onOpen={onOpenArtifact}
            onUnstar={onUnstar}
          />
        ))}
      </div>
    </div>
  )
})

// ─── StarredArtifactCard ────────────────────────────────────────────────────

interface StarredArtifactCardProps {
  artifact: Artifact
  onOpen: (artifact: Artifact) => void
  onUnstar: (id: string) => void
}

const StarredArtifactCard = memo(function StarredArtifactCard({
  artifact,
  onOpen,
  onUnstar,
}: StarredArtifactCardProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const handleClick = useCallback(() => onOpen(artifact), [onOpen, artifact])

  const handleUnstar = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onUnstar(artifact.id)
  }, [onUnstar, artifact.id])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(artifact)
    }
  }, [onOpen, artifact])

  const renderer = resolveRenderer(artifact.kind, artifact.mimeType)
  const isDiagram = artifact.kind === 'diagram'
  const isMarkdown = artifact.mimeType === 'text/markdown'
  const isHtml = artifact.mimeType === 'text/html'
    || artifact.fileExtension === '.html' || artifact.fileExtension === '.htm'
  const Icon = isDiagram ? GitBranch : isHtml ? Globe : FileText
  const preview = artifact.contentPreview
  const hasPreview = preview != null && preview.length > 0

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
      aria-label={`Open ${artifact.title}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[hsl(var(--border)/0.5)]">
        <Icon className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        <span className="text-xs font-medium text-[hsl(var(--foreground))] truncate flex-1">
          {artifact.title}
        </span>
        <button
          onClick={handleUnstar}
          className="p-0.5 rounded text-amber-400 hover:text-amber-500 transition-colors opacity-70 hover:opacity-100"
          aria-label={`Unstar ${artifact.title}`}
        >
          <Star className="w-3 h-3 fill-current" aria-hidden="true" />
        </button>
        {isDiagram ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4 shrink-0">{t('starred.mermaid')}</Badge>
        ) : artifact.fileExtension ? (
          <Badge variant="secondary" className="px-1 py-0 text-[9px] leading-3.5 shrink-0">{artifact.fileExtension}</Badge>
        ) : null}
      </div>

      {/* Body */}
      <div className="px-2.5 pt-1.5 space-y-1">
        {artifact.filePath && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.5)] truncate font-mono" title={artifact.filePath}>
            {artifact.filePath}
          </p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
            {renderer}
          </Badge>
          {artifact.starredAt && (
            <span className="flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">
              <Clock className="w-2.5 h-2.5" aria-hidden="true" />
              {formatRelativeTime(artifact.starredAt)}
            </span>
          )}
        </div>
      </div>

      {/* Content preview — from DB SUBSTR(content, 1, 2000) */}
      {hasPreview ? (
        isHtml ? (
          /* HTML — CSS-scaled iframe thumbnail (no gradient, self-contained) */
          <div className="relative mt-1 mx-2.5 mb-1.5 overflow-hidden rounded-sm pointer-events-none" aria-label={t('starred.contentPreview')}>
            <div className="relative aspect-[16/10]">
              <iframe
                srcDoc={preview!}
                sandbox=""
                title={`HTML thumbnail: ${artifact.title}`}
                className="absolute top-0 left-0 w-[200%] h-[200%] border-0 bg-white"
                style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}
                tabIndex={-1}
              />
            </div>
          </div>
        ) : (
          <div className="relative mt-1">
            <div className="px-2.5 py-1.5 max-h-24 overflow-hidden" aria-label={isDiagram ? t('starred.diagramPreview') : t('starred.contentPreview')}>
              {isDiagram ? (
                <DiagramThumbnail code={preview!} />
              ) : isMarkdown ? (
                <Suspense fallback={<div className="text-xs text-[hsl(var(--muted-foreground))]">{t('common:loading')}</div>}>
                  <MarkdownContent content={preview!} />
                </Suspense>
              ) : (
                <pre className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-all leading-relaxed">
                  {safeSlice(preview!, 0, 500)}
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
            {t('starred.contentUnavailable')}
          </p>
        </div>
      )}

      {/* Hover hint */}
      <div className="px-2.5 py-1 text-[10px] text-[hsl(var(--primary))] opacity-0 group-hover:opacity-100 transition-opacity">
        {t('starred.clickToPreview')}
      </div>
    </div>
  )
})

// ─── StarredArtifactViewerDialog ────────────────────────────────────────────

interface StarredArtifactViewerDialogProps {
  artifact: Artifact
  open: boolean
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

const StarredArtifactViewerDialog = memo(function StarredArtifactViewerDialog({
  artifact,
  open,
  onClose,
}: StarredArtifactViewerDialogProps): React.JSX.Element {
  const { t } = useTranslation('schedule')
  const { t: tCommon } = useTranslation('common')
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('preview')

  const renderer = resolveRenderer(artifact.kind, artifact.mimeType)
  const isDiagram = renderer === 'mermaid'
  const isMarkdown = renderer === 'markdown'
  const isHtml = renderer === 'html'
    || artifact.fileExtension === '.html' || artifact.fileExtension === '.htm'
  const language = languageFromMimeType(artifact.mimeType)

  // Fetch content on mount
  useEffect(() => {
    setLoading(true)
    getAppAPI()['get-artifact-content'](artifact.id)
      .then((c) => setContent(c))
      .catch(() => setContent(null))
      .finally(() => setLoading(false))
  }, [artifact.id])

  const hasContent = content != null && content.length > 0
  const lineCount = hasContent ? content!.split('\n').length : 0

  // Determine if preview mode is meaningful
  const supportsPreview = isDiagram || isMarkdown || isHtml

  const Icon = isDiagram ? GitBranch : isHtml ? Globe : FileText

  // Star context — reconstruct from artifact's persisted session/project info.
  const starContext: FileViewerStarContext | undefined = artifact.sessionId
    ? { type: 'session', sessionId: artifact.sessionId, issueId: artifact.issueId, projectId: artifact.projectId }
    : artifact.projectId
    ? { type: 'project', projectId: artifact.projectId }
    : undefined

  // For in-memory content without a real file path (e.g. gen_html artifacts),
  // provide explicit metadata so FileViewerStarButton derives correct mimeType.
  const starMetadata = !artifact.filePath
    ? { title: artifact.title, mimeType: artifact.mimeType, fileExtension: artifact.fileExtension }
    : undefined

  // ---- Download handler (view-mode-aware for diagrams) ----
  const handleDownload = useCallback(() => {
    if (!hasContent) return

    const baseName = isDiagram ? artifact.title.toLowerCase().replace(/\s+/g, '-') : artifact.title

    if (isDiagram && viewMode === 'preview') {
      try {
        const svg = renderMermaid(content!, resolveThemeColors())
        getAppAPI()['download-file'](`${baseName}.svg`, svg)
      } catch {
        getAppAPI()['download-file'](`${baseName}.mmd`, content!)
      }
    } else if (isDiagram) {
      getAppAPI()['download-file'](`${baseName}.mmd`, content!)
    } else {
      getAppAPI()['download-file'](baseName, content!)
    }
  }, [artifact.title, content, hasContent, isDiagram, viewMode])

  return (
    <Dialog open={open} onClose={onClose} title={artifact.title} size="3xl" className="!max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--border))]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{artifact.title}</h3>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
              {renderer}
            </Badge>
            {hasContent && (
              <FileViewerStarButton
                filePath={artifact.filePath ?? ''}
                content={content!}
                starContext={starContext}
                metadata={starMetadata}
              />
            )}
            {hasContent && (
              <button
                onClick={handleDownload}
                className="p-0.5 rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
                aria-label={`${tCommon('download')} ${isDiagram ? (viewMode === 'preview' ? 'SVG' : tCommon('source')) : artifact.title}`}
                title={isDiagram ? (viewMode === 'preview' ? t('starred.downloadSvg') : t('starred.downloadSource')) : t('starred.downloadFile', { title: artifact.title })}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {artifact.filePath ?? artifact.kind}
            {hasContent && (
              <>
                <span className="mx-1.5">·</span>
                {language}
                <span className="mx-1.5">·</span>
                {lineCount.toLocaleString()} {tCommon('lines')}
                <span className="mx-1.5">·</span>
                {content!.length.toLocaleString()} {tCommon('chars')}
              </>
            )}
            {artifact.starredAt && (
              <>
                <span className="mx-1.5">·</span>
                {t('starred.starred')} {formatRelativeTime(artifact.starredAt)}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {/* Preview / Source toggle (only when content loaded and preview supported) */}
          {hasContent && supportsPreview && (
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
                {tCommon('preview')}
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
                {tCommon('source')}
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            aria-label={t('starred.closeViewer')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content area — polymorphic by renderer */}
      {loading ? (
        <div className="h-[82vh] flex items-center justify-center">
          <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]" />
        </div>
      ) : !hasContent ? (
        <div className="h-[82vh] flex flex-col items-center justify-center gap-2 text-[hsl(var(--muted-foreground))]">
          <FileText className="w-6 h-6 opacity-30" aria-hidden="true" />
          <p className="text-xs text-center leading-relaxed">
            {t('starred.contentUnavailableFull')}
          </p>
        </div>
      ) : viewMode === 'preview' && isDiagram ? (
        /* Diagram preview — MermaidBlock renders SVG directly */
        <div className="h-[82vh] overflow-y-auto px-6 py-4 flex items-start justify-center">
          <MermaidBlock code={content!} />
        </div>
      ) : viewMode === 'preview' && isMarkdown ? (
        <Suspense fallback={<LoadingFallback label={t('starred.loadingPreview')} />}>
          <MarkdownPreviewWithToc content={content!} className="h-[82vh]" />
        </Suspense>
      ) : viewMode === 'preview' && isHtml ? (
        <iframe
          srcDoc={wrapHtmlForSafePreview(content!)}
          sandbox="allow-scripts"
          title={`HTML preview: ${artifact.title}`}
          className="w-full h-[82vh] border-0 bg-white"
        />
      ) : (
        /* Source view or code-only files */
        <div className="h-[82vh]">
          <Suspense fallback={<LoadingFallback label={t('files:editor.loadingEditor', 'Loading editor…')} />}>
            <CodeViewer content={content!} language={language} />
          </Suspense>
        </div>
      )}
    </Dialog>
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

// ─── Shared fallback ────────────────────────────────────────────────────────

function LoadingFallback({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center h-32 text-xs text-[hsl(var(--muted-foreground))]">
      <Loader2 className="w-4 h-4 mr-1.5 motion-safe:animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}
