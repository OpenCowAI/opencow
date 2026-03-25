// SPDX-License-Identifier: Apache-2.0

/**
 * RepoSourceList — displays user-registered repository sources with
 * expandable capability preview and inline install.
 *
 * Architecture:
 *   RepoSourceList (Dialog wrapper, install state owner)
 *     └── RepoSourceRow (single row, callback props, expand/collapse)
 *           └── CategoryBadge (capability type indicator)
 *
 * Install flow: Row triggers onInstall → List builds MarketSkillSummary →
 * InstallDialog opens with useMarketInstall + useMarketAnalysisSession hooks.
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GitBranch,
  RefreshCw,
  Trash2,
  Plus,
  Wifi,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ChevronDown,
  Download,
  Pencil,
} from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { Tooltip } from '@/components/ui/Tooltip'
import { InstallDialog } from '@/components/MarketView/InstallDialog'
import { useMarketInstall } from '@/hooks/useMarketInstall'
import { useMarketAnalysisSession } from '@/hooks/useMarketAnalysisSession'
import { cn } from '@/lib/utils'
import { AddRepoSourceDialog } from './AddRepoSourceDialog'
import type {
  RepoSource,
  RepoSourceInput,
  RepoSourceUpdateInput,
  RepoSourceBrowseResult,
  MarketSkillSummary,
  MarketplaceId,
} from '@shared/types'
import type { UseRepoSourcesReturn } from '@/hooks/useRepoSources'

// ─── Helpers ─────────────────────────────────────────────────

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildSkillSummary(source: RepoSource): MarketSkillSummary {
  return {
    slug: source.slug,
    name: source.name,
    description: '',
    author: source.slug.split('/')[0] || source.name,
    repoUrl: source.url,
    marketplaceId: `user-repo:${source.id}` as MarketplaceId,
    tags: [],
  }
}

// ─── CategoryBadge ───────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  skill: 'bg-purple-500/10 text-purple-400',
  command: 'bg-blue-500/10 text-blue-400',
  agent: 'bg-emerald-500/10 text-emerald-400',
  rule: 'bg-gray-500/10 text-gray-400',
  hook: 'bg-cyan-500/10 text-cyan-400',
  'mcp-server': 'bg-orange-500/10 text-orange-400',
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded text-[10px] font-medium',
        CATEGORY_STYLES[category] ?? CATEGORY_STYLES.rule,
      )}
    >
      {category}
    </span>
  )
}

// ─── RepoSourceRow (callback props, expandable) ──────────────

interface RepoSourceRowProps {
  source: RepoSource
  onSync: () => Promise<void>
  onTest: () => Promise<{ ok: boolean; error?: string }>
  onDelete: () => Promise<void>
  onBrowse: () => Promise<RepoSourceBrowseResult>
  onInstall: () => void
  onEdit: () => void
}

function RepoSourceRow({
  source,
  onSync,
  onTest,
  onDelete,
  onBrowse,
  onInstall,
  onEdit,
}: RepoSourceRowProps) {
  const { t } = useTranslation('sessions')
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Expand / capability preview state
  const [expanded, setExpanded] = useState(false)
  const [browseResult, setBrowseResult] = useState<RepoSourceBrowseResult | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setTestResult(null)
    try {
      await onSync()
    } finally {
      setSyncing(false)
    }
  }, [onSync])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await onTest()
      setTestResult(result)
    } catch {
      setTestResult({ ok: false, error: 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }, [onTest])

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }, [onDelete])

  const handleToggleExpand = useCallback(async () => {
    const willExpand = !expanded
    setExpanded(willExpand)
    if (willExpand && !browseResult) {
      setBrowsing(true)
      try {
        const result = await onBrowse()
        setBrowseResult(result)
      } finally {
        setBrowsing(false)
      }
    }
  }, [expanded, browseResult, onBrowse])

  const syncStatusColor =
    source.syncStatus === 'error'
      ? 'text-[hsl(var(--destructive))]'
      : source.syncStatus === 'syncing'
        ? 'text-[hsl(var(--primary))]'
        : 'text-[hsl(var(--muted-foreground)/0.5)]'

  return (
    <div className="px-4 py-3 hover:bg-[hsl(var(--foreground)/0.02)] transition-colors">
      <div className="group flex items-start gap-2">
        {/* Expand chevron */}
        <button
          type="button"
          onClick={handleToggleExpand}
          className="mt-0.5 p-0.5 shrink-0 rounded text-[hsl(var(--muted-foreground)/0.5)] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />
          }
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleToggleExpand}
              className="text-sm font-medium text-[hsl(var(--foreground))] truncate hover:underline text-left"
            >
              {source.name}
            </button>
            {/* Platform badge */}
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
              {source.platform === 'gitlab' ? 'GitLab' : 'GitHub'}
            </span>
            {source.hasCredential && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]">
                PAT
              </span>
            )}
            {source.branch && (
              <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">
                <GitBranch className="h-2.5 w-2.5" />
                {source.branch}
              </span>
            )}
            {/* Capability count badge (shown after first browse) */}
            {browseResult && browseResult.capabilities.length > 0 && (
              <span className="shrink-0 text-[10px] text-[hsl(var(--muted-foreground)/0.5)]">
                {t('repoSource.capCount', '{{count}} capabilities', { count: browseResult.capabilities.length })}
              </span>
            )}
          </div>

          <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] truncate mt-0.5">
            {source.url}
          </p>

          {/* Sync status row */}
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-[10px]', syncStatusColor)}>
              {source.syncStatus === 'syncing'
                ? t('repoSource.syncing', 'Syncing…')
                : source.syncStatus === 'error'
                  ? t('repoSource.syncError', 'Sync error')
                  : source.lastSyncedAt
                    ? t('repoSource.lastSynced', 'Synced {{time}}', { time: formatTime(source.lastSyncedAt) })
                    : t('repoSource.neverSynced', 'Not synced')
              }
            </span>
            {source.lastCommit && (
              <code className="text-[10px] text-[hsl(var(--muted-foreground)/0.4)] font-mono">
                {source.lastCommit.slice(0, 7)}
              </code>
            )}
            {source.syncError && (
              <span className="text-[10px] text-[hsl(var(--destructive))] truncate max-w-[200px]" title={source.syncError}>
                {source.syncError}
              </span>
            )}
          </div>

          {/* Test result inline */}
          {testResult && (
            <div className={cn(
              'flex items-center gap-1.5 mt-1.5 text-[11px]',
              testResult.ok ? 'text-emerald-600' : 'text-[hsl(var(--destructive))]',
            )}>
              {testResult.ok
                ? <><CheckCircle2 className="h-3 w-3" />{t('repoSource.testOk', 'Connection OK')}</>
                : <><XCircle className="h-3 w-3" />{testResult.error ?? t('repoSource.testFail', 'Connection failed')}</>
              }
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Install */}
          <Tooltip content={t('repoSource.installTip', 'Install')} position="bottom">
            <button
              type="button"
              onClick={onInstall}
              className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.05)] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          {/* Edit */}
          <Tooltip content={t('repoSource.editTip', 'Edit')} position="bottom">
            <button
              type="button"
              onClick={onEdit}
              className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          {/* Test */}
          <Tooltip content={t('repoSource.testTip', 'Test connection to the repository')} position="bottom">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>

          {/* Sync */}
          <Tooltip content={t('repoSource.syncTip', 'Fetch the latest commit from the repository')} position="bottom">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground)/0.05)] transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-2 py-1 rounded text-[10px] font-medium bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('repoSource.confirmDelete', 'Confirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded text-[10px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
              >
                {t('repoSource.cancelDelete', 'No')}
              </button>
            </div>
          ) : (
            <Tooltip content={t('repoSource.deleteTip', 'Remove this repository source')} position="bottom">
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="p-1.5 rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/0.05)] transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Expandable capability preview */}
      {expanded && (
        <div className="mt-2 ml-6 pl-2 border-l-2 border-[hsl(var(--border)/0.3)] space-y-0.5">
          {browsing ? (
            <div className="flex items-center gap-2 py-2 text-xs text-[hsl(var(--muted-foreground)/0.5)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('repoSource.browsing', 'Loading capabilities…')}
            </div>
          ) : browseResult?.status === 'error' ? (
            <p className="text-xs text-[hsl(var(--destructive))] py-2">
              {browseResult.message || t('repoSource.browseError', 'Failed to load capabilities')}
            </p>
          ) : browseResult?.capabilities.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground)/0.5)] py-2">
              {t('repoSource.browseEmpty', 'No capabilities found in this repository')}
            </p>
          ) : (
            browseResult?.capabilities.map((cap) => (
              <div
                key={`${cap.category}/${cap.name}`}
                className="flex items-center gap-2 py-1 px-1"
              >
                <CategoryBadge category={cap.category} />
                <span className="text-xs text-[hsl(var(--foreground)/0.8)]">{cap.name}</span>
              </div>
            ))
          )}
          {browseResult?.status === 'degraded' && (
            <p className="text-[10px] text-amber-500 mt-1 px-1">
              {browseResult.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────

interface RepoSourceListProps {
  open: boolean
  onClose: () => void
  sources: RepoSource[]
  loading: boolean
  hook: UseRepoSourcesReturn
}

export function RepoSourceList({
  open,
  onClose,
  sources,
  loading,
  hook,
}: RepoSourceListProps) {
  const { t } = useTranslation('sessions')
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<RepoSource | null>(null)

  // Install flow state
  const [installTarget, setInstallTarget] = useState<MarketSkillSummary | null>(null)
  const installHook = useMarketInstall()
  const analysisSession = useMarketAnalysisSession()

  const handleAddSubmit = useCallback(async (input: RepoSourceInput) => {
    await hook.create(input)
    setShowAdd(false)
  }, [hook])

  const handleEditSubmit = useCallback(async (input: RepoSourceInput) => {
    if (!editTarget) return
    const updateInput: RepoSourceUpdateInput = {
      name: input.name,
      branch: input.branch,
      auth: input.auth,
    }
    await hook.update(editTarget.id, updateInput)
    setEditTarget(null)
  }, [editTarget, hook])

  const handleCloseInstall = useCallback(() => {
    analysisSession.reset()
    setInstallTarget(null)
    installHook.reset()
  }, [installHook, analysisSession])

  const showingInstall = !!installTarget
  const showingEdit = !!editTarget

  return (
    <>
      <Dialog
        open={open && !showAdd && !showingEdit && !showingInstall}
        onClose={onClose}
        title={t('repoSource.title', 'Repository Sources')}
        size="xl"
      >
        <div className="flex flex-col max-h-[70vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border)/0.4)]">
            <div>
              <h2 className="text-[15px] font-semibold text-[hsl(var(--foreground))]">
                {t('repoSource.title', 'Repository Sources')}
              </h2>
              <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] mt-0.5">
                {t('repoSource.subtitle', 'Manage custom skill repositories from GitHub or GitLab')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                'hover:bg-[hsl(var(--primary)/0.9)]',
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('repoSource.add', 'Add')}
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground)/0.4)]" />
              </div>
            ) : sources.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="p-3 rounded-xl bg-[hsl(var(--muted)/0.5)] mb-3">
                  <GitBranch className="h-6 w-6 text-[hsl(var(--muted-foreground)/0.4)]" />
                </div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {t('repoSource.emptyTitle', 'No repositories yet')}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground)/0.6)] mt-1 max-w-xs">
                  {t('repoSource.emptyDescription', 'Add a GitHub or GitLab repository to browse and install skills from your own sources.')}
                </p>
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className={cn(
                    'mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors',
                    'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                    'hover:bg-[hsl(var(--primary)/0.9)]',
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('repoSource.addFirst', 'Add Repository')}
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border)/0.3)]">
                {sources.map((source) => (
                  <RepoSourceRow
                    key={source.id}
                    source={source}
                    onSync={() => hook.sync(source.id).then(() => {})}
                    onTest={() => hook.testConnection(source.id)}
                    onDelete={() => hook.remove(source.id)}
                    onBrowse={() => hook.browse(source.id)}
                    onInstall={() => setInstallTarget(buildSkillSummary(source))}
                    onEdit={() => setEditTarget(source)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* Add dialog */}
      <AddRepoSourceDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSubmit={handleAddSubmit}
      />

      {/* Edit dialog */}
      <AddRepoSourceDialog
        open={showingEdit}
        onClose={() => setEditTarget(null)}
        onSubmit={handleEditSubmit}
        editSource={editTarget ?? undefined}
      />

      {/* Install dialog — reuses existing marketplace InstallDialog */}
      <InstallDialog
        open={showingInstall}
        skill={installTarget}
        installing={installHook.installing}
        result={installHook.result}
        error={installHook.error}
        progress={installHook.progress}
        analysis={analysisSession}
        onInstall={(scope, prefix) => {
          if (!installTarget) return
          installHook.install({
            slug: installTarget.slug,
            marketplaceId: installTarget.marketplaceId,
            scope,
            namespacePrefix: prefix,
          })
        }}
        onClose={handleCloseInstall}
      />
    </>
  )
}
