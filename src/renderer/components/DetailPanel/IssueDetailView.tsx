// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pencil, Trash2, Check, ArrowUpRight, Link, FileText, ExternalLink, FolderCode } from 'lucide-react'
import { useBlockBrowserView } from '@/hooks/useBlockBrowserView'
import type { Artifact } from '@shared/types'
import { useAppStore } from '../../stores/appStore'
import { useIssueStore } from '../../stores/issueStore'
import { useIssueFileOverlayStore } from '@/stores/issueFileOverlayStore'
import { selectIssue, deleteIssue } from '../../actions/issueActions'
import { cn } from '../../lib/utils'
import { IssueStatusIcon, IssuePriorityIcon } from '../IssuesView/IssueIcons'
import { IssueFormModal } from '../IssueForm/IssueFormModal'
import { PillDropdown, PILL_TRIGGER } from '../ui/PillDropdown'
import { Tooltip } from '../ui/Tooltip'
import { SessionPanel } from './SessionPanel/SessionPanel'
import { ComposeView } from './SessionPanel/ComposeView'
import { SessionContextBar } from './SessionContextBar'
import { ImageThumbnail } from './ImageThumbnail'
import { ImageLightbox } from './ImageLightbox'
import { ContextFileDropZone } from './ContextFileDropZone'
import { getSessionInputFocus } from '../../lib/sessionInputRegistry'
import { ProjectScopeProvider } from '../../contexts/ProjectScopeContext'
import { ContextFilesProvider, useContextFiles } from '../../contexts/ContextFilesContext'
import { isIssueUnread } from '@shared/types'
import type { IssueStatus, IssuePriority } from '@shared/types'
import { resolveProjectPath } from '../../lib/issueSessionUtils'
import { getAppAPI } from '@/windowAPI'
import { useIssueSessionRuntime } from '@/hooks/useIssueSessionRuntime'

// Stable empty array constants — used as selector defaults to avoid
// creating new array references on every store notification.
const EMPTY_CHILD_ISSUES: import('@shared/types').IssueSummary[] = []

const STATUS_VALUES: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'done', 'cancelled']
const STATUS_LABEL_KEYS: Record<IssueStatus, string> = {
  backlog: 'detail.statusOptions.backlog',
  todo: 'detail.statusOptions.todo',
  in_progress: 'detail.statusOptions.inProgress',
  done: 'detail.statusOptions.done',
  cancelled: 'detail.statusOptions.cancelled'
}

const PRIORITY_VALUES: IssuePriority[] = ['urgent', 'high', 'medium', 'low']
const PRIORITY_LABEL_KEYS: Record<IssuePriority, string> = {
  urgent: 'detail.priorityOptions.urgent',
  high: 'detail.priorityOptions.high',
  medium: 'detail.priorityOptions.medium',
  low: 'detail.priorityOptions.low'
}

function DeleteConfirmModal({
  title,
  onConfirm,
  onCancel
}: {
  title: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm delete"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{ overscrollBehavior: 'contain' }}
    >
      <div className="bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg shadow-lg p-4 max-w-sm mx-4">
        <p className="text-sm text-[hsl(var(--foreground))] mb-3">
          Delete &quot;{title}&quot;? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function IssueImageGallery({ images }: { images: import('@shared/types').IssueImage[] }): React.JSX.Element {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  return (
    <div>
      <label className="block text-xs text-[hsl(var(--muted-foreground))] mb-1">Images</label>
      <div className="flex flex-wrap gap-1.5">
        {images.map((img, i) => {
          const dataUri = `data:${img.mediaType};base64,${img.data}`
          return (
            <ImageThumbnail
              key={img.id}
              src={dataUri}
              alt={`Attached image ${i + 1}`}
              onClick={() => setLightboxIdx(i)}
            />
          )
        })}
      </div>
      {lightboxIdx !== null && (
        <ImageLightbox
          src={`data:${images[lightboxIdx].mediaType};base64,${images[lightboxIdx].data}`}
          alt={`Attached image ${lightboxIdx + 1}`}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  )
}

interface IssueDetailViewProps {
  issueId: string
  /** When provided, used instead of `selectIssue(null)` for the close (X) button. */
  onClose?: () => void
  /** When provided, used instead of `selectIssue(id)` for sub-issue / parent-issue navigation. */
  onNavigateToIssue?: (issueId: string) => void
}

export function IssueDetailView({ issueId, onClose, onNavigateToIssue }: IssueDetailViewProps): React.JSX.Element {
  const { t } = useTranslation('issues')
  const openIssueFileOverlay = useIssueFileOverlayStore((s) => s.openIssueFileOverlay)
  // Block browser view when delete confirmation modal is open
  const [confirmDelete, setConfirmDelete] = useState(false)
  useBlockBrowserView('delete-confirm-modal', confirmDelete)
  // ── Store subscriptions ────────────────────────────────────────────
  //
  // CRITICAL: Only subscribe to the MINIMAL data this component needs.
  // Broad subscriptions like `(s) => s.issues` or `(s) => s.projects`
  // cause re-renders on EVERY unrelated store mutation (e.g. loadIssues()
  // from updateIssue, any project change).  Combined with SessionPanel
  // not being memoized, this cascade exceeds React's 50-update limit.
  //
  // Strategy:
  //   - Collections (issues, projects): snapshot reads via getState()
  //   - Keyed caches (childIssuesCache): narrow selector with stable key
  //   - Actions (functions): direct selector (always stable in Zustand)
  //   - Issue detail: narrow selector by issueId (already done)
  // ─────────────────────────────────────────────────────────────────

  // Snapshot read: optional fast-path fallback for instant rendering
  // while the full issue detail loads. NOT used for existence checks —
  // the detail cache (via loadIssueDetail API) is the authority for that.
  const issueSummary = useMemo(
    () => useIssueStore.getState().issueById[issueId] ?? null,
    [issueId],
  )

  // Store action functions — stable references, safe to subscribe
  const updateIssue = useIssueStore((s) => s.updateIssue)
  const loadIssueDetail = useIssueStore((s) => s.loadIssueDetail)
  const loadChildIssues = useIssueStore((s) => s.loadChildIssues)
  const markIssueRead = useIssueStore((s) => s.markIssueRead)

  // Tracks whether the API confirmed this issue does not exist.
  // Distinguished from "not yet loaded" to avoid premature "not found" display.
  const [loadFailed, setLoadFailed] = useState(false)

  const [showEditModal, setShowEditModal] = useState(false)
  // Artifact candidates — loaded lazily only when contextRefs include artifacts
  const [starredArtifacts, setStarredArtifacts] = useState<Artifact[]>([])
  const [idCopied, setIdCopied] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const prevIssueIdRef = useRef(issueId)
  const focusedIssueIdRef = useRef<string | null>(null)
  const markingReadRef = useRef(false)

  // NARROW selector: subscribes only to THIS issue's cache entry, not the entire Map.
  // Critical for eliminating re-renders when OTHER issues are updated.
  // (Previously subscribed to the whole `issueDetailCache` Map — every updateIssue()
  // for any issue triggered a re-render here.)
  const issue = useIssueStore((s) => s.issueDetailCache.get(issueId) ?? null)

  // NOTE: session subscription has been moved INTO SessionPanel (via useSessionByBinding)
  // so that IssueDetailView does NOT re-render on every streaming message tick.
  // IssueDetailView no longer imports or calls useSessionForIssue().
  const {
    isStarting,
    composeMode,
    setComposeMode,
    viewingArchivedSessionId,
    initialPrompt,
    handleComposeStart,
    sessionBinding,
    capabilities,
    sessionHistoryCtx,
  } = useIssueSessionRuntime(issueId)

  // Standalone mode: when custom onClose is provided, this component is used
  // inside a floating overlay (e.g. IssuePreviewOverlay from Starred Artifacts).
  // In that case we must NOT call selectIssue — which sets detailContext and
  // causes the main DetailPanel to expand alongside the overlay. Instead we
  // call loadIssueDetail directly to fetch the full issue data without side-effects.
  const isStandalone = !!onClose

  // ── Issue detail loading ──────────────────────────────────────────
  //
  // Two effects cooperate to guarantee the detail cache is populated:
  //
  // 1. **Primary load** (issueId change):
  //    Fires when the component receives a new issueId (mount, issue
  //    switch, or project switch restoring a different issueId).
  //    Resets loadFailed and kicks off loadIssueDetail.
  //
  // 2. **Cache-eviction recovery** (issue goes null):
  //    Fires when navigateToProject clears issueDetailCache while the
  //    issueId prop stays the same (rare but possible with All Projects).
  //    Detects issue→null transition and re-triggers loadIssueDetail.
  //
  // loadIssueDetail de-duplicates concurrent calls for the same ID, so
  // even if both effects fire simultaneously only one API call is made.
  // ─────────────────────────────────────────────────────────────────

  // Primary load: ensure full detail data is loaded for this issue.
  // In standalone mode we only set selectedIssueId (needed for loadIssueDetail's
  // race-condition guard) without touching detailContext / _tabDetails.
  useEffect(() => {
    if (!issueId) return
    setLoadFailed(false)

    if (isStandalone) {
      useAppStore.setState({ selectedIssueId: issueId })
    }

    // Already cached — no loading needed (loadIssueDetail still fires a
    // background refresh since it deduplicates, but we're not blocking on it).
    if (useIssueStore.getState().issueDetailCache.has(issueId)) {
      loadIssueDetail(issueId) // background refresh
      return
    }

    let cancelled = false
    loadIssueDetail(issueId).then((result) => {
      if (!cancelled && !result) {
        setLoadFailed(true)
      }
    })
    return () => { cancelled = true }
  }, [issueId, isStandalone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cache-eviction recovery: when navigateToProject clears issueDetailCache,
  // the `issue` subscription fires with null. If loadFailed is false (not a
  // genuine 404), we re-trigger the load to repopulate the cache.
  useEffect(() => {
    if (issue !== null || loadFailed || !issueId) return

    let cancelled = false
    loadIssueDetail(issueId).then((result) => {
      if (!cancelled && !result) {
        setLoadFailed(true)
      }
    })
    return () => { cancelled = true }
  }, [issue, loadFailed, issueId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus Session Console input when switching issues.
  // Waits until `issue` is loaded (so SessionPanel / SessionInputBar are mounted
  // and the focus callback is registered) then focuses with a requestAnimationFrame
  // to allow the TipTap editor one frame to settle after (re-)mount.
  useEffect(() => {
    if (!issue || issueId === focusedIssueIdRef.current) return
    focusedIssueIdRef.current = issueId
    const raf = requestAnimationFrame(() => {
      getSessionInputFocus()?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [issueId, issue])

  // Content cross-fade: replay CSS animation when issue data arrives for a new issueId.
  // Uses direct DOM manipulation to avoid key-driven remount of the entire component tree.
  useEffect(() => {
    if (prevIssueIdRef.current !== issueId && issue) {
      const el = contentRef.current
      if (el) {
        el.classList.remove('detail-content-enter')
        void el.offsetWidth // force reflow to restart animation
        el.classList.add('detail-content-enter')
      }
      prevIssueIdRef.current = issueId
    }
  }, [issueId, issue])

  // Lazily load artifact metadata for contextRef label resolution
  useEffect(() => {
    const hasArtifactRef = issue?.contextRefs?.some((r) => r.type === 'artifact')
    if (!hasArtifactRef) return
    getAppAPI()['get-context-candidates']()
      .then(({ artifacts }) => setStarredArtifacts(artifacts))
      .catch(() => {})
  }, [issue?.contextRefs])

  // Reset the marking guard when switching issues so the new issue can be
  // marked as read immediately (previous async markIssueRead may still be in-flight).
  useEffect(() => {
    markingReadRef.current = false
  }, [issueId])

  // Mark unread issues as read when viewed.
  // Re-triggers when lastAgentActivityAt changes so that real-time agent
  // completions are automatically marked as read while the user is watching.
  //
  // Guarded by markingReadRef to prevent concurrent markIssueRead calls when
  // rapid lastAgentActivityAt updates arrive during streaming — markIssueRead
  // is async (IPC → store update), and overlapping calls can cascade store
  // mutations that exceed React's maximum update depth.
  useEffect(() => {
    if (issue && isIssueUnread(issue) && !markingReadRef.current) {
      markingReadRef.current = true
      markIssueRead(issue.id).finally(() => {
        markingReadRef.current = false
      })
    }
  }, [issue?.id, issue?.lastAgentActivityAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive from summary (always available for listed issues) so the header
  // shows the correct title even while full detail is still loading.
  const isSubIssue = !!(issue?.parentIssueId ?? issueSummary?.parentIssueId)

  // NARROW selector: only re-renders when THIS issue's children change,
  // not when any child-issue cache entry changes.
  const childIssues = useIssueStore(
    useCallback((s) => s.childIssuesCache[issueId] ?? EMPTY_CHILD_ISSUES, [issueId]),
  )

  // Load child issues for top-level issues
  useEffect(() => {
    if (issueId && issue && !issue.parentIssueId) {
      loadChildIssues(issueId)
    }
  }, [issueId, issue?.parentIssueId, loadChildIssues])

  // Derive the project path once — used for session creation and as ambient scope.
  // Snapshot read: projects rarely change at runtime; no subscription needed.
  const projectPath = useMemo(
    () => resolveProjectPath(issue?.projectId, useAppStore.getState().projects),
    [issue?.projectId],
  )

  const statusOptions = useMemo(
    () => STATUS_VALUES.map((v) => ({ value: v, label: t(STATUS_LABEL_KEYS[v]) })),
    [t],
  )
  const priorityOptions = useMemo(
    () => PRIORITY_VALUES.map((v) => ({ value: v, label: t(PRIORITY_LABEL_KEYS[v]) })),
    [t],
  )

  // ── Render gate ──────────────────────────────────────────────────
  //
  // Display source priority: full issue (cache) > summary (list fallback).
  // "Not found" is ONLY shown when loadIssueDetail API confirms non-existence
  // (loadFailed === true). While loading, a skeleton placeholder is shown
  // instead — this eliminates the flash of "not found" during project switches
  // where the issues list is temporarily stale.
  // ─────────────────────────────────────────────────────────────────
  const displaySource = issue ?? issueSummary

  if (!displaySource) {
    if (loadFailed) {
      return (
        <div className="flex items-center justify-center h-full text-[hsl(var(--muted-foreground))] text-sm">
          {t('detail.notFound')}
        </div>
      )
    }
    // Still loading — show skeleton placeholder
    return (
      <div className="h-full flex flex-col overflow-hidden animate-pulse">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div className="h-4 w-24 rounded bg-[hsl(var(--muted)/0.3)]" />
          <div className="flex gap-1">
            <div className="h-6 w-6 rounded bg-[hsl(var(--muted)/0.2)]" />
            <div className="h-6 w-6 rounded bg-[hsl(var(--muted)/0.2)]" />
          </div>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="h-5 w-3/4 rounded bg-[hsl(var(--muted)/0.3)]" />
          <div className="h-3 w-1/2 rounded bg-[hsl(var(--muted)/0.2)]" />
          <div className="h-3 w-2/3 rounded bg-[hsl(var(--muted)/0.2)]" />
        </div>
      </div>
    )
  }

  // Derived data — computed from full issue when available, otherwise from summary
  const displayTitle = displaySource.title
  const displayStatus = displaySource.status
  const displayPriority = displaySource.priority

  // Snapshot reads — no subscription needed for display-only lookups.
  // These recalculate on every render but DON'T subscribe to store changes,
  // eliminating the cascade from loadIssues() and project mutations.
  const projectId = displaySource.projectId
  const projectName = projectId
    ? (useAppStore.getState().projects.find((p) => p.id === projectId)?.name ?? projectId)
    : null

  const parentIssueId = displaySource.parentIssueId
  const parentIssueSummary = isSubIssue && parentIssueId
    ? useIssueStore.getState().issueById[parentIssueId] ?? null
    : null

  const handleStatusChange = async (status: IssueStatus): Promise<void> => {
    if (!issue) return
    await updateIssue(issue.id, { status })
  }

  const handlePriorityChange = async (priority: IssuePriority): Promise<void> => {
    if (!issue) return
    await updateIssue(issue.id, { priority })
  }

  const handleDelete = async (): Promise<void> => {
    if (!issue) return
    await deleteIssue(issue.id)
    setConfirmDelete(false)
  }

  const formatTime = (ts: number): string => {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ts))
  }

  const formatRelativeTime = (ts: number): string => {
    const diffMs = Date.now() - ts
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return t('remote.justNow')
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return t('remote.minutesAgo', { count: diffMin })
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return t('remote.hoursAgo', { count: diffHr })
    const diffDay = Math.floor(diffHr / 24)
    return t('remote.daysAgo', { count: diffDay })
  }

  return (
    <ContextFilesProvider>
    <IssueDetailContent className="h-full flex flex-col overflow-hidden">
      {/* Ref for CSS animation replay on issue switch — must be a real DOM element */}
      <div ref={contentRef} className="h-full flex flex-col overflow-hidden">
      {/* Header — always rendered; action buttons disabled while loading */}
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
        <h2 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate min-w-0 flex-1" title={displayTitle}>
          {displayTitle}
        </h2>
        <div className="no-drag flex items-center gap-1">
          {issue ? (
            <>
              <Tooltip content={t('detail.openIssueFileSheet')} position="bottom">
                <button
                  onClick={() => openIssueFileOverlay(issue.id)}
                  className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label={t('detail.openIssueFileSheetAria')}
                >
                  <FolderCode className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content={t('detail.editIssue')} position="bottom">
                <button
                  onClick={() => setShowEditModal(true)}
                  className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label={t('detail.editIssue')}
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content={t('detail.deleteIssue')} position="bottom">
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  aria-label={t('detail.deleteIssue')}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              {/* Invisible placeholders to keep header width constant while loading */}
              <span className="invisible p-1.5" aria-hidden="true"><FolderCode className="w-3.5 h-3.5" /></span>
              <span className="invisible p-1.5" aria-hidden="true"><Pencil className="w-3.5 h-3.5" /></span>
              <span className="invisible p-1.5" aria-hidden="true"><Trash2 className="w-3.5 h-3.5" /></span>
            </>
          )}
          <Tooltip content={t('detail.closeDetailPanel')} position="bottom" align="end">
            <button
              onClick={() => onClose ? onClose() : selectIssue(null)}
              className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              aria-label={t('detail.closeDetailPanel')}
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content — fixed layout: issue info (auto height) + console (flex-1) */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden">
        <div className="shrink-0 relative z-10">
          <div className="flex flex-col">
            {/* Non-scrollable header — dropdowns live here so they are never clipped by overflow */}
            <div className="shrink-0 px-4 pt-3 space-y-2 relative z-10">
              {/* Parent Issue breadcrumb (compact, for sub-issues only) */}
              {isSubIssue && parentIssueSummary && (
                <button
                  onClick={() => onNavigateToIssue ? onNavigateToIssue(parentIssueId!) : selectIssue(parentIssueId!)}
                  className="flex items-center gap-1 text-[11px] text-[hsl(var(--primary))] hover:underline transition-colors truncate"
                >
                  <ArrowUpRight className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{parentIssueSummary.title}</span>
                </button>
              )}

              {/* Meta strip: Status | Priority | Labels | Project — all inline */}
              <div className="flex flex-wrap items-center gap-1.5">
                {issue ? (
                  <>
                    <PillDropdown
                      open={statusOpen}
                      onOpenChange={setStatusOpen}
                      position="below"
                      trigger={
                        <button
                          onClick={() => setStatusOpen((prev) => !prev)}
                          className={PILL_TRIGGER}
                          aria-label="Change status"
                        >
                          <IssueStatusIcon status={displayStatus} className="w-3.5 h-3.5" />
                          {statusOptions.find((o) => o.value === displayStatus)?.label ?? displayStatus}
                        </button>
                      }
                    >
                      {statusOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            handleStatusChange(opt.value)
                            setStatusOpen(false)
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                            displayStatus === opt.value
                              ? 'bg-[hsl(var(--primary)/0.08)]'
                              : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                          )}
                        >
                          <IssueStatusIcon status={opt.value} className="w-3.5 h-3.5" />
                          <span className="flex-1">{opt.label}</span>
                          {displayStatus === opt.value && <Check className="w-3 h-3" />}
                        </button>
                      ))}
                    </PillDropdown>

                    <PillDropdown
                      open={priorityOpen}
                      onOpenChange={setPriorityOpen}
                      position="below"
                      trigger={
                        <button
                          onClick={() => setPriorityOpen((prev) => !prev)}
                          className={PILL_TRIGGER}
                          aria-label="Change priority"
                        >
                          <IssuePriorityIcon priority={displayPriority} className="w-3.5 h-3.5" />
                          {priorityOptions.find((o) => o.value === displayPriority)?.label ?? displayPriority}
                        </button>
                      }
                    >
                      {priorityOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            handlePriorityChange(opt.value)
                            setPriorityOpen(false)
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                            displayPriority === opt.value
                              ? 'bg-[hsl(var(--primary)/0.08)]'
                              : 'hover:bg-[hsl(var(--foreground)/0.04)]'
                          )}
                        >
                          <IssuePriorityIcon priority={opt.value} className="w-3.5 h-3.5" />
                          <span className="flex-1">{opt.label}</span>
                          {displayPriority === opt.value && <Check className="w-3 h-3" />}
                        </button>
                      ))}
                    </PillDropdown>

                    {/* Labels inline */}
                    {issue.labels.map((label) => (
                      <span
                        key={label}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"
                      >
                        {label}
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    {/* Static pills while loading — show summary data without interactive dropdowns */}
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <IssueStatusIcon status={displayStatus} className="w-3.5 h-3.5 inline-block mr-1" />
                      {statusOptions.find((o) => o.value === displayStatus)?.label ?? displayStatus}
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <IssuePriorityIcon priority={displayPriority} className="w-3.5 h-3.5 inline-block mr-1" />
                      {priorityOptions.find((o) => o.value === displayPriority)?.label ?? displayPriority}
                    </span>
                  </>
                )}

                {/* Project badge inline */}
                {projectName && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--accent-foreground))]">
                    {projectName}
                  </span>
                )}
              </div>

              {/* Git context: branch, worktree, working directory */}
              <SessionContextBar
                issueId={issueId}
                viewingArchivedSessionId={viewingArchivedSessionId}
                projectPath={projectPath ?? null}
              />

              {/* Compact ID + timestamps — single line */}
              {issue && (
                <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <button
                    onClick={() => {
                      getAppAPI()['clipboard:write-text'](issue.id)
                      setIdCopied(true)
                      setTimeout(() => setIdCopied(false), 1500)
                    }}
                    className="font-mono hover:text-[hsl(var(--foreground))] transition-colors cursor-pointer"
                    title={`ID: ${issue.id}`}
                    aria-label={`Copy issue ID ${issue.id}`}
                  >
                    {idCopied ? t('detail.copied') : `${issue.id.slice(0, 6)}…`}
                  </button>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{formatTime(issue.createdAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{t('detail.updatedAt', { time: formatTime(issue.updatedAt) })}</span>
                </div>
              )}

              {/* Remote source metadata */}
              {issue?.providerId && (
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span className="font-medium text-[hsl(var(--foreground)/0.5)]">{t('remote.source')}</span>
                  {issue.remoteUrl ? (
                    <a
                      href={issue.remoteUrl}
                      onClick={(e) => {
                        e.preventDefault()
                        if (/^https?:\/\//i.test(issue.remoteUrl!)) window.open(issue.remoteUrl!, '_blank')
                      }}
                      className="inline-flex items-center gap-0.5 hover:text-[hsl(var(--foreground))] transition-colors"
                      title={issue.remoteUrl}
                    >
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>#{issue.remoteNumber}</span>
                    </a>
                  ) : issue.remoteNumber != null ? (
                    <span className="inline-flex items-center gap-0.5">
                      <ExternalLink className="w-2.5 h-2.5" />
                      <span>#{issue.remoteNumber}</span>
                    </span>
                  ) : null}
                  {issue.remoteState && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={cn(
                        'px-1 py-px rounded font-medium',
                        issue.remoteState === 'open'
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                      )}>
                        {issue.remoteState}
                      </span>
                    </>
                  )}
                  {issue.remoteSyncedAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{t('remote.synced', { time: formatRelativeTime(issue.remoteSyncedAt) })}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Scrollable body — images, context refs, sub-issues (only rendered when content exists) */}
            {issue && ((issue.images && issue.images.length > 0) || (issue.contextRefs && issue.contextRefs.length > 0) || (!isSubIssue && childIssues.length > 0)) && (
              <div className="overflow-y-auto px-4 pt-2 space-y-2">
                {/* Attached Images */}
                {issue.images && issue.images.length > 0 && (
                  <IssueImageGallery images={issue.images} />
                )}

                {/* Context References */}
                {issue.contextRefs && issue.contextRefs.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1.5">
                      {issue.contextRefs.map((ref) => {
                        const label = ref.type === 'issue'
                          ? (useIssueStore.getState().issueById[ref.id]?.title ?? ref.id)
                          : (starredArtifacts.find((a) => a.id === ref.id)?.title ||
                             starredArtifacts.find((a) => a.id === ref.id)?.filePath ||
                             ref.id)
                        return (
                          <span
                            key={ref.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-[hsl(var(--foreground)/0.06)] text-[hsl(var(--foreground)/0.65)]"
                          >
                            {ref.type === 'issue' ? (
                              <Link className="w-3 h-3 shrink-0" />
                            ) : (
                              <FileText className="w-3 h-3 shrink-0" />
                            )}
                            <span className="max-w-[200px] truncate">{label}</span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Sub-Issues list (only for top-level issues) */}
                {!isSubIssue && childIssues.length > 0 && (
                  <div className="space-y-px">
                    {childIssues.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onNavigateToIssue ? onNavigateToIssue(child.id) : selectIssue(child.id)}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                      >
                        <IssueStatusIcon status={child.status} className="w-3 h-3 shrink-0" />
                        <span className="flex-1 text-xs truncate text-[hsl(var(--foreground))]">
                          {child.title}
                        </span>
                        <IssuePriorityIcon priority={child.priority} className="w-3 h-3 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {issue ? (
            <ProjectScopeProvider projectPath={projectPath} projectId={issue.projectId ?? undefined}>
              {composeMode && !issue?.sessionId ? (
                <ComposeView
                  initialPrompt={initialPrompt}
                  onSubmit={handleComposeStart}
                  onCancel={() => setComposeMode(false)}
                />
              ) : (
                <SessionPanel
                  binding={sessionBinding}
                  lifecycle={issue.status === 'done' || issue.status === 'cancelled' ? 'readonly' : 'active'}
                  isStarting={isStarting}
                  capabilities={capabilities}
                  history={sessionHistoryCtx}
                />
              )}
            </ProjectScopeProvider>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-xs text-[hsl(var(--muted-foreground))] animate-pulse">{t('detail.loading')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {showEditModal && issue && <IssueFormModal issueId={issue.id} defaultProjectId={issue.projectId} onClose={() => setShowEditModal(false)} />}

      {/* Delete confirmation */}
      {confirmDelete && issue && (
        <DeleteConfirmModal
          title={issue.title}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
    </IssueDetailContent>
    </ContextFilesProvider>
  )
}

function IssueDetailContent({
  children,
  className,
}: {
  children: React.ReactNode
  className: string
}): React.JSX.Element {
  const { addFiles } = useContextFiles()

  return (
    <ContextFileDropZone className={className} onFilesDrop={({ files }) => addFiles(files)}>
      {children}
    </ContextFileDropZone>
  )
}
