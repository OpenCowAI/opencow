// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/appStore'
import {
  X,
  FileCode,
  FolderOpen,
  Pencil,
  Trash2,
  History,
  ChevronDown,
  ChevronRight,
  Tag,
  Package,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { Switch } from '@/components/ui/switch'

const log = createLogger('CapabilityDetail')
import { CodeViewer } from '@/components/ui/code-viewer'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_MAP } from '../ChatView/categoryRegistry'
import { useCapabilitySnapshot } from '@/hooks/useCapabilitySnapshot'
import { usePackageUninstall } from '@/hooks/usePackageUninstall'
import { resolveCapability, toCapabilityId } from '@/lib/capabilityAdapter'
import type {
  CapabilityEntry,
  ManagedCapabilityIdentifier,
  ManagedCapabilityCategory,
  CapabilityMountInfo,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ── Types ────────────────────────────────────────────────────────────

interface CapabilityDetailViewProps {
  identifier: ManagedCapabilityIdentifier
  onClose?: () => void
}

interface VersionRecord {
  id: number
  contentHash: string
  createdAt: number
}

// ── Helpers ──────────────────────────────────────────────────────────

function getSourceContent(entry: CapabilityEntry): string {
  if (entry.kind === 'document') return entry.body
  return JSON.stringify(entry.config, null, 2)
}

function getSourceLanguage(entry: CapabilityEntry): string {
  if (entry.kind === 'config') return 'json'
  return 'markdown'
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Main Component ───────────────────────────────────────────────────

export function CapabilityDetailView({
  identifier,
  onClose,
}: CapabilityDetailViewProps): React.JSX.Element {
  const storeCloseDetail = useAppStore((s) => s.closeDetail)
  const openDetail = useAppStore((s) => s.openDetail)
  const closeDetail = onClose ?? storeCloseDetail

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolve live entry from the snapshot — auto-refreshes when snapshot changes
  const { snapshot } = useCapabilitySnapshot(identifier.projectId)
  const liveEntry = snapshot
    ? resolveCapability(snapshot, identifier.category, identifier.name, identifier.scope)
    : undefined

  // External mount entries are read-only (managed externally, not individually editable)
  const isExternalMount = !!liveEntry?.mountInfo
  const isPackageMount = liveEntry?.mountInfo?.sourceOrigin === 'marketplace'

  // Package uninstall — imperative hook (requestUninstall opens dialog + stores target)
  const pkgUninstall = usePackageUninstall(closeDetail)

  const handleRequestUninstall = useCallback(() => {
    if (!liveEntry?.mountInfo || liveEntry.mountInfo.sourceOrigin !== 'marketplace') return
    pkgUninstall.requestUninstall({
      prefix: liveEntry.mountInfo.namespace,
      scope: identifier.scope,
      projectId: identifier.projectId,
    })
  }, [liveEntry?.mountInfo?.namespace, liveEntry?.mountInfo?.sourceOrigin, identifier.scope, identifier.projectId, pkgUninstall.requestUninstall])

  // Version history state
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)

  const config = CATEGORY_MAP[identifier.category as ManagedCapabilityCategory]
  const Icon = config?.icon
  const displayName = identifier.category === 'command' ? `/${identifier.name}` : identifier.name

  // ── Toggle ───────────────────────────────────────────────────────

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setError(null)
      try {
        await getAppAPI()['capability:toggle']({
          scope: identifier.scope,
          category: identifier.category,
          name: identifier.name,
          enabled,
          projectId: identifier.projectId,
        })
        // Snapshot auto-refreshes via capabilities:changed event
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Toggle failed')
      }
    },
    [identifier],
  )

  // ── Edit ─────────────────────────────────────────────────────────

  const handleEdit = useCallback(() => {
    openDetail({
      type: 'capability-edit',
      identifier,
    })
  }, [openDetail, identifier])

  // ── Delete ───────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setError(null)
    try {
      await getAppAPI()['capability:delete']({
        category: identifier.category,
        name: identifier.name,
        scope: identifier.scope,
        projectId: identifier.projectId,
      })
      closeDetail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
      setShowDeleteDialog(false)
    }
  }, [identifier, closeDetail])


  // ── Version History ──────────────────────────────────────────────

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true)
    try {
      const result = await getAppAPI()['capability:versions']({
        category: identifier.category,
        name: identifier.name,
        limit: 20,
      })
      setVersions(result)
    } catch (err) {
      log.error('Failed to load versions:', err)
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }, [identifier.category, identifier.name])

  const handleToggleVersions = useCallback(() => {
    const next = !versionsOpen
    setVersionsOpen(next)
    if (next && versions.length === 0) {
      loadVersions()
    }
  }, [versionsOpen, versions.length, loadVersions])

  const handleViewVersion = useCallback(async (id: number) => {
    try {
      const content = await getAppAPI()['capability:version-detail']({ id })
      setSelectedVersion(content)
    } catch (err) {
      log.error('Failed to load version detail:', err)
      setError('Failed to load version')
    }
  }, [])

  // ── Render ───────────────────────────────────────────────────────

  // Entry not yet loaded (snapshot still loading)
  if (!liveEntry) {
    return (
      <aside
        className="h-full flex flex-col bg-[hsl(var(--card))] items-center justify-center"
        aria-label={`${config?.titleKey ?? identifier.category} detail: ${identifier.name}`}
      >
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading...</p>
      </aside>
    )
  }

  return (
    <aside
      className="h-full flex flex-col bg-[hsl(var(--card))]"
      aria-label={`${config?.titleKey ?? identifier.category} detail: ${identifier.name}`}
    >
      {/* Header */}
      <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <Icon className={cn('h-4 w-4 shrink-0', config?.textColor)} aria-hidden="true" />
          )}
          <h3 className="font-semibold text-sm truncate">{displayName}</h3>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full shrink-0',
              identifier.scope === 'project'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
            )}
          >
            {identifier.scope}
          </span>
        </div>
        <button
          onClick={closeDetail}
          className="p-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Meta */}
      <div className="px-4 py-3 border-b border-[hsl(var(--border))] space-y-2">
        {/* Category + Toggle */}
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full',
              config?.bgColor,
              config?.textColor,
            )}
          >
            {config?.titleKey ?? identifier.category}
          </span>
          <Switch
            checked={liveEntry.enabled}
            onChange={handleToggle}
            size="md"
            label={liveEntry.enabled ? 'Disable' : 'Enable'}
          />
        </div>

        {/* File path */}
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="font-mono truncate text-[11px]">{identifier.filePath}</span>
        </div>

        {/* Tags */}
        {liveEntry.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" aria-hidden="true" />
            {liveEntry.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground))]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Description */}
        {liveEntry.description && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            {liveEntry.description}
          </p>
        )}
      </div>

      {/* Error */}
      {(error || pkgUninstall.error) && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/5" role="alert">
          {error || pkgUninstall.error}
        </div>
      )}

      {/* Mount info (if applicable) */}
      {isExternalMount && liveEntry.mountInfo && (
        <div className="px-4 py-2.5 border-b border-[hsl(var(--border))] bg-amber-500/5">
          <div className="flex items-center gap-2 text-xs">
            <Package className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-[hsl(var(--foreground))] font-medium">
              From: {liveEntry.mountInfo.namespace}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.6)]">
              Read-only
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
              v{liveEntry.mountInfo.version} · {isPackageMount ? 'Installed from Marketplace' : 'Managed by plugin'}
            </span>
            {isPackageMount && (
              <button
                type="button"
                onClick={handleRequestUninstall}
                disabled={pkgUninstall.uninstalling}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-md transition-colors',
                  'text-red-500 hover:bg-red-500/10',
                  pkgUninstall.uninstalling && 'opacity-50 cursor-not-allowed',
                )}
              >
                {pkgUninstall.uninstalling ? 'Uninstalling…' : 'Uninstall Package'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Source tab label + action buttons */}
      <div className="flex items-center border-b border-[hsl(var(--border))]">
        <div className="px-4 py-2 text-xs font-medium text-[hsl(var(--foreground))] border-b-2 border-[hsl(var(--ring))] flex items-center gap-1.5">
          <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
          Source
        </div>
        {!isExternalMount && (
          <div className="ml-auto flex items-center gap-1 px-2">
            <button
              type="button"
              onClick={handleEdit}
              aria-label={`Edit ${identifier.name}`}
              className="p-1.5 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <Pencil
                className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              disabled={deleting}
              aria-label={`Delete ${identifier.name}`}
              className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Source Content */}
      <div className="flex-1 min-h-0">
        {selectedVersion !== null ? (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-1.5 bg-[hsl(var(--muted)/0.3)] text-xs text-[hsl(var(--muted-foreground))]">
              <span>Version snapshot</span>
              <button
                type="button"
                onClick={() => setSelectedVersion(null)}
                className="text-[hsl(var(--primary))] hover:underline"
              >
                Back to current
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <CodeViewer content={selectedVersion} language={getSourceLanguage(liveEntry)} />
            </div>
          </div>
        ) : (
          <CodeViewer
            content={getSourceContent(liveEntry)}
            language={getSourceLanguage(liveEntry)}
          />
        )}
      </div>

      {/* Version History (collapsible) */}
      <div className="border-t border-[hsl(var(--border))]">
        <button
          type="button"
          onClick={handleToggleVersions}
          className="w-full flex items-center gap-1.5 px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--foreground)/0.02)] transition-colors"
          aria-expanded={versionsOpen}
        >
          {versionsOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <History className="h-3 w-3" aria-hidden="true" />
          <span>Version History</span>
        </button>
        {versionsOpen && (
          <div className="px-4 pb-3 max-h-40 overflow-y-auto">
            {versionsLoading ? (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Loading...</p>
            ) : versions.length === 0 ? (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">No versions yet</p>
            ) : (
              <div className="space-y-1">
                {versions.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleViewVersion(v.id)}
                    className="w-full flex items-center justify-between py-1 px-2 rounded text-[11px] hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
                  >
                    <span className="font-mono text-[hsl(var(--muted-foreground))]">
                      {v.contentHash.slice(0, 8)}
                    </span>
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {i === 0 ? 'latest' : formatTimestamp(v.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title={`Delete ${config?.titleKey ?? identifier.category}`}
        message={`Are you sure you want to delete "${identifier.name}"?`}
        detail="This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
      />

      <ConfirmDialog
        open={!!pkgUninstall.pendingTarget}
        title="Uninstall Package"
        message={`Uninstall package "${pkgUninstall.pendingTarget?.prefix ?? ''}"?`}
        detail="All capabilities from this package will be removed. This action cannot be undone."
        confirmLabel="Uninstall"
        variant="destructive"
        onConfirm={pkgUninstall.confirm}
        onCancel={pkgUninstall.cancel}
      />
    </aside>
  )
}
