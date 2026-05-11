// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, FileText, Globe, GitBranch, Download, Clock, Loader2, X, CircleDot, FolderGit2, Search } from 'lucide-react'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import { useArtifactsStore } from '@/stores/artifactsStore'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/Dialog'
import { ProjectPicker } from '@/components/ui/ProjectPicker'
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
// `MarkdownContent` is imported eagerly: it's used as the thumbnail
// renderer for every Markdown card, so wrapping it in `lazy` produced
// a Suspense fallback ("加载中") under every card on first paint and
// they all bottlenecked on the same async import. The module is
// already pulled into the renderer bundle by other surfaces, so
// bundling it here costs ~nothing while eliminating the "loading"
// flash that scroll-and-return would otherwise be needed to clear.
import { MarkdownContent } from '@/components/ui/MarkdownContent'

// The heavy renderers below are still lazy because they only show up
// inside the full-screen `StarredArtifactViewerDialog` — paid for once
// when the dialog opens, not 60 times on the card grid.
//
// Module factories are extracted so the dialog can `preload()` the chunks
// in parallel with the content-loading IPC.  Without this, the lazy import
// only kicks off *after* `get-artifact-content` / `read-file-content`
// resolves and the preview branch finally mounts — stacking the chunk-load
// latency on top of the IPC and producing a "Loading preview…" Suspense
// fallback that resolves only as the dialog is closing.  Bundlers
// deduplicate in-flight import promises, so calling these factories twice
// resolves to the same module instance.
const loadMarkdownPreview = (): Promise<typeof import('@/components/ui/MarkdownPreviewWithToc')> =>
  import('@/components/ui/MarkdownPreviewWithToc')
const loadCodeViewer = (): Promise<typeof import('@/components/ui/code-viewer')> =>
  import('@/components/ui/code-viewer')

const MarkdownPreviewWithToc = lazy(() =>
  loadMarkdownPreview().then((m) => ({ default: m.MarkdownPreviewWithToc }))
)
const CodeViewer = lazy(() =>
  loadCodeViewer().then((m) => ({ default: m.CodeViewer }))
)

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewMode = 'preview' | 'source'

/**
 * Bucket key shape:
 *   - 'today' / 'yesterday' / 'day-before'  → fixed recent buckets
 *   - 'date:YYYY-MM-DD'                     → one bucket per calendar day,
 *                                             for anything older than 2 days
 *
 * Encoding the date directly in the key keeps Map keys stable and lets
 * us sort by the lexical YYYY-MM-DD without parsing back out.
 */
type DateBucketKey = string

interface DateBucket {
  key: DateBucketKey
  label: string
  /** Latest artifact timestamp in this bucket — used to sort buckets descending. */
  latest: number
  artifacts: Artifact[]
}

// ─── useInView ──────────────────────────────────────────────────────────────

/**
 * One-shot in-view hook used to defer expensive thumbnail rendering
 * until a card is about to scroll into the viewport. Once `inView`
 * flips to true it stays true, so heavy children don't re-mount as
 * the card leaves and re-enters.
 *
 * Strategy:
 *   1. Synchronously check `getBoundingClientRect()` in the ref
 *      callback (post-commit, layout is complete). If the element
 *      sits inside the viewport (plus `rootMarginPx` pre-warm band),
 *      flip `inView` straight away — `IntersectionObserver`'s async
 *      initial callback can miss this on the first paint after mount,
 *      which made cards above the fold stuck on the loading state
 *      until the user manually scrolled.
 *   2. Only when the initial check says "off-screen" do we install
 *      an IntersectionObserver to wait for the user to scroll there.
 *
 * 200 px of pre-warm gives roughly one screenful below the viewport
 * so card content is ready by the time the user reaches it.
 */
const IN_VIEW_PRE_WARM_PX = 200

function useInView(rootMarginPx = IN_VIEW_PRE_WARM_PX): {
  ref: (node: Element | null) => void
  inView: boolean
} {
  const [inView, setInView] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)
  // Once we've flipped to in-view we never go back; this guard keeps
  // late ref re-attachments from re-creating the observer.
  const settledRef = useRef(false)

  const ref = useCallback(
    (node: Element | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!node || settledRef.current) return

      // Synchronous initial probe. Layout is settled at the point a
      // ref callback fires, so `getBoundingClientRect` returns
      // authoritative numbers.
      const rect = node.getBoundingClientRect()
      const inViewport =
        rect.bottom > -rootMarginPx &&
        rect.top < window.innerHeight + rootMarginPx
      if (inViewport) {
        settledRef.current = true
        setInView(true)
        return
      }

      // Off-screen → wait for the user to scroll close enough.
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              settledRef.current = true
              setInView(true)
              obs.disconnect()
              return
            }
          }
        },
        { rootMargin: `${rootMarginPx}px` },
      )
      obs.observe(node)
      observerRef.current = obs
    },
    [rootMarginPx],
  )

  return { ref, inView }
}

// ─── Date bucketing ─────────────────────────────────────────────────────────

/** `YYYY-MM-DD` in local time. */
function localDateString(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function bucketKeyForTimestamp(ts: number, now: number): DateBucketKey {
  const DAY_MS = 86400_000
  const nowDate = new Date(now)
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  const startOfYesterday = startOfToday - DAY_MS
  const startOfDayBefore = startOfToday - 2 * DAY_MS

  if (ts >= startOfToday) return 'today'
  if (ts >= startOfYesterday) return 'yesterday'
  if (ts >= startOfDayBefore) return 'day-before'
  return `date:${localDateString(ts)}`
}

// ─── StarredArtifactsView ───────────────────────────────────────────────────

export const StarredArtifactsView = memo(function StarredArtifactsView(): React.JSX.Element {
  const { t } = useTranslation('schedule')
  // ── Reactive state ──
  const starredArtifacts = useArtifactsStore((s) => s.starredArtifacts)
  const issueById = useIssueStore((s) => s.issueById)
  const projects = useAppStore((s) => s.projects)

  // Issues from `useIssueStore` are scoped to the current issues view's
  // filter — they cover at most the active project. Starred artifacts can
  // reference issues from any project, so we batch-fetch the titles for
  // any `issueId` we encounter that isn't already in the store and merge
  // the two sources before passing them downstream.
  const [fetchedIssueTitles, setFetchedIssueTitles] = useState<Record<string, string>>({})
  useEffect(() => {
    const uniqueIds = new Set<string>()
    for (const a of starredArtifacts) {
      if (a.issueId && !issueById[a.issueId] && !fetchedIssueTitles[a.issueId]) {
        uniqueIds.add(a.issueId)
      }
    }
    if (uniqueIds.size === 0) return
    let cancelled = false
    void Promise.all(
      [...uniqueIds].map(async (id) => {
        const issue = await getAppAPI()['get-issue'](id)
        return [id, issue?.title ?? null] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setFetchedIssueTitles((prev) => {
        const next = { ...prev }
        for (const [id, title] of entries) {
          if (title) next[id] = title
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [starredArtifacts, issueById, fetchedIssueTitles])

  // Single lookup table merging the live issue store and our local cache.
  // Live store entries take precedence (they're the freshest source of
  // truth); cached fetches fill the cross-project gaps.
  const mergedIssueById = useMemo(() => {
    const result: Record<string, { title?: string } | undefined> = { ...issueById }
    for (const [id, title] of Object.entries(fetchedIssueTitles)) {
      if (!result[id]) result[id] = { title }
    }
    return result
  }, [issueById, fetchedIssueTitles])

  const viewer = useDialogState<Artifact>()
  const [previewIssueId, setPreviewIssueId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Filter state — local to this view; the underlying store always
  // loads all starred artifacts and we narrow client-side so toggling
  // filters is instantaneous.
  //
  // `projectFilter` is initialised from the current sidebar project
  // context (so "MorePopover → 收藏产物" from inside project A lands
  // pre-filtered to A) and re-synced whenever the user navigates
  // between projects. Manual filter changes within the same project
  // context are preserved.
  const sidebarProjectId = useAppStore(selectProjectId)
  const [searchQuery, setSearchQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(sidebarProjectId)
  const lastSyncedProjectIdRef = useRef(sidebarProjectId)
  useEffect(() => {
    if (sidebarProjectId !== lastSyncedProjectIdRef.current) {
      lastSyncedProjectIdRef.current = sidebarProjectId
      setProjectFilter(sidebarProjectId)
    }
  }, [sidebarProjectId])

  // Load all starred artifacts on mount. Filtering happens client-side.
  useEffect(() => {
    setLoading(true)
    useArtifactsStore.getState().loadStarredArtifacts()
      .finally(() => setLoading(false))
  }, [])

  // Fast lookups for context display + search matching
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return map
  }, [projects])

  // ── Apply filters (search + project) ───────────────────────────
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return starredArtifacts.filter((a) => {
      if (projectFilter && a.projectId !== projectFilter) return false
      if (!q) return true
      const inTitle = a.title.toLowerCase().includes(q)
      const inPath = a.filePath?.toLowerCase().includes(q) ?? false
      // Search across the merged source so cross-project issue titles
      // (only present in `fetchedIssueTitles`) are still matchable.
      const issueTitle = a.issueId ? mergedIssueById[a.issueId]?.title?.toLowerCase() ?? '' : ''
      const inIssue = issueTitle.includes(q)
      const projectName = a.projectId ? projectNameById.get(a.projectId)?.toLowerCase() ?? '' : ''
      const inProject = projectName.includes(q)
      return inTitle || inPath || inIssue || inProject
    })
  }, [starredArtifacts, searchQuery, projectFilter, mergedIssueById, projectNameById])

  // ── Group by date bucket, descending (newest first) ────────────
  const dateBuckets = useMemo((): DateBucket[] => {
    const now = Date.now()
    const map = new Map<DateBucketKey, Artifact[]>()

    for (const a of filtered) {
      const ts = a.starredAt ?? a.createdAt ?? 0
      const bucket = bucketKeyForTimestamp(ts, now)
      const list = map.get(bucket) ?? []
      list.push(a)
      map.set(bucket, list)
    }

    const labelForKey = (key: DateBucketKey): string => {
      if (key === 'today') return t('starred.bucketToday')
      if (key === 'yesterday') return t('starred.bucketYesterday')
      if (key === 'day-before') return t('starred.bucketDayBeforeYesterday')
      // 'date:YYYY-MM-DD' — strip prefix, show raw date
      return key.startsWith('date:') ? key.slice(5) : key
    }

    const buckets: DateBucket[] = []
    for (const [key, artifacts] of map) {
      artifacts.sort((a, b) => (b.starredAt ?? 0) - (a.starredAt ?? 0))
      buckets.push({
        key,
        label: labelForKey(key),
        latest: artifacts[0]?.starredAt ?? 0,
        artifacts,
      })
    }
    // Sort by latest artifact timestamp descending — today comes first,
    // older dates follow naturally without a separate priority table.
    return buckets.sort((a, b) => b.latest - a.latest)
  }, [filtered, t])

  const handleOpenArtifact = viewer.show

  const handleNavigateToIssue = useCallback((issueId: string) => {
    setPreviewIssueId(issueId)
  }, [])

  const handleUnstar = useCallback(async (id: string) => {
    const { toggleArtifactStar, loadStarredArtifacts } = useArtifactsStore.getState()
    await toggleArtifactStar(id, false)
    await loadStarredArtifacts()
  }, [])

  // Header — page-level title row (mirrors ProjectsListView). Drag-region
  // gives the user a click target to drag the window from the top. Stays
  // present in loading/empty states so layout is stable.
  const pageHeader = (
    <div className="shrink-0">
      <div className="drag-region flex items-start justify-between gap-4 px-5 pt-3 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
              {t('starred.title')}
            </h1>
            <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
              {starredArtifacts.length}
            </span>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t('starred.subtitle')}
          </p>
        </div>
      </div>
    </div>
  )

  // Sticky filter row — search + project picker. Lives inside the scroll
  // container so it adheres to the top edge when scrolling the cards.
  const filterRow = (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-[hsl(var(--card))] px-5 py-2">
      <div className="relative w-[260px]">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('starred.searchPlaceholder')}
          aria-label={t('starred.searchPlaceholder')}
          className={cn(
            'w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]',
            'pl-7 pr-2.5 py-1.5 text-xs text-[hsl(var(--foreground))]',
            'placeholder:text-[hsl(var(--muted-foreground)/0.6)]',
            'focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]',
          )}
        />
      </div>
      <ProjectPicker
        value={projectFilter}
        onChange={setProjectFilter}
        placeholder={t('starred.allProjects')}
        ariaLabel={t('starred.filterByProject')}
        portal
      />
    </div>
  )

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {pageHeader}
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 motion-safe:animate-spin text-[hsl(var(--muted-foreground))]" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {pageHeader}

      <div className="min-h-0 flex-1 overflow-auto">
        {filterRow}

        {starredArtifacts.length === 0 ? (
          <EmptyState
            title={t('starred.noStarred')}
            description={t('starred.noStarredDesc')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('starred.noStarredFiltered')} />
        ) : (
          <div className="px-5 py-4 space-y-5">
            {dateBuckets.map((bucket) => (
              <DateBucketSection
                key={bucket.key}
                bucket={bucket}
                projectNameById={projectNameById}
                issueById={mergedIssueById}
                onOpenArtifact={handleOpenArtifact}
                onNavigateToIssue={handleNavigateToIssue}
                onUnstar={handleUnstar}
              />
            ))}
          </div>
        )}
      </div>

      {viewer.data && (
        <StarredArtifactViewerDialog
          artifact={viewer.data}
          open={viewer.open}
          onClose={viewer.close}
        />
      )}

      {previewIssueId && (
        <IssuePreviewOverlay
          issueId={previewIssueId}
          onClose={() => setPreviewIssueId(null)}
        />
      )}
    </div>
  )
})

// ─── EmptyState ─────────────────────────────────────────────────────────────

function EmptyState({ title, description }: { title: string; description?: string }): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[hsl(var(--muted-foreground))] px-8 py-12">
      <Star className="w-10 h-10 opacity-20" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-center leading-relaxed opacity-70 max-w-[280px]">
          {description}
        </p>
      )}
    </div>
  )
}

// ─── DateBucketSection ──────────────────────────────────────────────────────

interface DateBucketSectionProps {
  bucket: DateBucket
  projectNameById: Map<string, string>
  issueById: Record<string, { title?: string } | undefined>
  onOpenArtifact: (artifact: Artifact) => void
  onNavigateToIssue: (issueId: string) => void
  onUnstar: (id: string) => void
}

const DateBucketSection = memo(function DateBucketSection({
  bucket,
  projectNameById,
  issueById,
  onOpenArtifact,
  onNavigateToIssue,
  onUnstar,
}: DateBucketSectionProps): React.JSX.Element {
  return (
    <div>
      {/* Date header — uppercase muted label, count badge on the right */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
          {bucket.label}
        </span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
          {bucket.artifacts.length}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {bucket.artifacts.map((artifact) => (
          <StarredArtifactCard
            key={artifact.id}
            artifact={artifact}
            projectName={artifact.projectId ? projectNameById.get(artifact.projectId) ?? null : null}
            // Only surface the chip when we can resolve a real issue
            // title — a "Unknown Issue" placeholder added more noise
            // than value. If the parent issue isn't loaded in
            // `issueById` the chip is omitted; the artifact remains
            // openable via its own card click.
            issueTitle={
              artifact.issueId ? issueById[artifact.issueId]?.title ?? null : null
            }
            onOpen={onOpenArtifact}
            onNavigateToIssue={onNavigateToIssue}
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
  /** Owning project's display name; `null` if the artifact has no project link. */
  projectName: string | null
  /** Owning issue's title; `null` if the artifact has no issue link. */
  issueTitle: string | null
  onOpen: (artifact: Artifact) => void
  onNavigateToIssue: (issueId: string) => void
  onUnstar: (id: string) => void
}

const StarredArtifactCard = memo(function StarredArtifactCard({
  artifact,
  projectName,
  issueTitle,
  onOpen,
  onNavigateToIssue,
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
  const { ref: previewRef, inView } = useInView()

  // When the artifact has no recorded preview (Edit-only, no Write op),
  // fall back to reading the file from disk — but only after the card
  // scrolls into view, so we don't fan out 60 IPC reads on mount.
  const [livePreview, setLivePreview] = useState<string | null>(null)
  const recordedPreview = artifact.contentPreview
  const hasRecordedPreview = recordedPreview != null && recordedPreview.length > 0
  useEffect(() => {
    if (!inView) return
    if (hasRecordedPreview) return
    if (!artifact.filePath || !artifact.projectId) return
    let cancelled = false
    const project = useAppStore
      .getState()
      .projects.find((p) => p.id === artifact.projectId)
    if (!project?.path) return
    void (async () => {
      const result = await getAppAPI()['read-file-content'](project.path, artifact.filePath!)
      if (cancelled || !result.ok) return
      // Truncate to match the DB-side `SUBSTR(content, 1, 2000)` budget
      // so the card preview render cost stays bounded.
      setLivePreview(result.data.content.slice(0, 2000))
    })()
    return () => {
      cancelled = true
    }
  }, [inView, hasRecordedPreview, artifact.filePath, artifact.projectId])

  const preview = hasRecordedPreview ? recordedPreview : livePreview
  const hasPreview = preview != null && preview.length > 0

  return (
    <div
      className={cn(
        'group/starred-card relative w-56 cursor-pointer overflow-hidden',
        'rounded-2xl border border-[hsl(var(--border)/0.55)] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]',
        // `min-h` keeps cards in the grid lined up vertically when
        // some have larger previews than others.
        'min-h-[220px]',
        // Hover affordance — mirrors `ProjectCard`'s lift + soft shadow.
        // The visual lift replaces the previous "click to preview"
        // hint, so the card no longer needs a flex-column layout to
        // pin text to the bottom.
        'transition-all duration-200',
        'hover:-translate-y-[5px] hover:shadow-[0_4px_12px_0_hsl(var(--foreground)/0.06)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
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
        {/* Context row — issue title (clickable) + project name. Each
            element is conditional; the row is omitted entirely when
            neither piece of context exists. */}
        {(issueTitle || projectName) && (
          <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] min-w-0">
            {issueTitle && artifact.issueId && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onNavigateToIssue(artifact.issueId!)
                }}
                // Negative margin compensates the hover padding so the
                // chip doesn't visually shift when its bg appears.
                className={cn(
                  'inline-flex items-center gap-0.5 min-w-0 max-w-[55%]',
                  'px-1 py-0.5 -mx-1 -my-0.5 rounded',
                  'hover:bg-[hsl(var(--foreground)/0.06)] hover:text-[hsl(var(--foreground))]',
                  'transition-colors',
                )}
                title={issueTitle}
              >
                <CircleDot className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{issueTitle}</span>
              </button>
            )}
            {issueTitle && projectName && (
              <span className="text-[hsl(var(--muted-foreground)/0.4)] shrink-0">·</span>
            )}
            {projectName && (
              <span className="inline-flex items-center gap-0.5 min-w-0 flex-1" title={projectName}>
                <FolderGit2 className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{projectName}</span>
              </span>
            )}
          </div>
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

      {/* Content preview — from DB SUBSTR(content, 1, 2000).
          The container is observed by `useInView`; heavy children
          (iframe / Mermaid / Markdown parse) only mount once the card
          scrolls within ~1 screenful of the viewport. Inner containers
          reserve the eventual content height so the layout doesn't
          jump when the real preview swaps in. */}
      <div ref={previewRef}>
        {hasPreview ? (
          isHtml ? (
            /* HTML — CSS-scaled iframe thumbnail (no gradient, self-contained) */
            <div className="relative mt-1 mx-2.5 mb-1.5 overflow-hidden rounded-sm pointer-events-none" aria-label={t('starred.contentPreview')}>
              <div className="relative aspect-[16/10] bg-[hsl(var(--muted)/0.25)]">
                {inView && (
                  <iframe
                    srcDoc={preview!}
                    sandbox=""
                    title={`HTML thumbnail: ${artifact.title}`}
                    className="absolute top-0 left-0 w-[200%] h-[200%] border-0 bg-white"
                    style={{ transform: 'scale(0.5)', transformOrigin: 'top left' }}
                    tabIndex={-1}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="relative mt-1">
              <div className="px-2.5 py-1.5 h-24 overflow-hidden" aria-label={isDiagram ? t('starred.diagramPreview') : t('starred.contentPreview')}>
                {inView && (
                  isDiagram ? (
                    <DiagramThumbnail code={preview!} />
                  ) : isMarkdown ? (
                    // No Suspense wrapper — `MarkdownContent` is now
                    // eagerly imported (see top of file), so this
                    // renders synchronously without a fallback flash.
                    <MarkdownContent content={preview!} />
                  ) : (
                    <pre className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] whitespace-pre-wrap break-all leading-relaxed">
                      {safeSlice(preview!, 0, 500)}
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
              {t('starred.contentUnavailable')}
            </p>
          </div>
        )}
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

  // Warm the lazy preview chunks in parallel with the content-loading IPC.
  // The preview branch only mounts after `loading` flips to false, so without
  // preloading the lazy chunk's network/parse cost would stack on top of the
  // IPC instead of running alongside it — exactly the "Loading preview…"
  // flash users see on first open of an artifact.
  useEffect(() => {
    void loadMarkdownPreview()
    void loadCodeViewer()
  }, [])

  // Fetch content on mount.
  //
  // Resolution order:
  //   1. Live file on disk (`read-file-content` via the artifact's
  //      `filePath` resolved under its owning project's path). This is
  //      the freshest source — captures edits that happened after the
  //      original Write was recorded.
  //   2. Recorded Write content (`get-artifact-content`). Used when the
  //      file no longer exists on disk (moved / deleted) or when the
  //      artifact is in-memory only (no `filePath`, e.g. `gen_html`).
  //
  // Without (1) an artifact that was only edited (no Write op recorded)
  // would surface "content unavailable" even though its file is sitting
  // right there on disk.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        if (artifact.filePath && artifact.projectId) {
          const project = useAppStore
            .getState()
            .projects.find((p) => p.id === artifact.projectId)
          if (project?.path) {
            const result = await getAppAPI()['read-file-content'](project.path, artifact.filePath)
            if (cancelled) return
            if (result.ok) {
              setContent(result.data.content)
              return
            }
            // Disk read failed (e.g. file deleted) — fall through to
            // the recorded Write snapshot below rather than giving up.
          }
        }

        const recorded = await getAppAPI()['get-artifact-content'](artifact.id)
        if (cancelled) return
        setContent(recorded)
      } catch {
        if (!cancelled) setContent(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [artifact.id, artifact.filePath, artifact.projectId])

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
