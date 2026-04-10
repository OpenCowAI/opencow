// SPDX-License-Identifier: Apache-2.0

/**
 * InlineCapabilityDetail — Full-width inline detail view for a managed capability.
 *
 * Replaces the narrow sidebar DetailPanel with a Linear-style in-page experience:
 *   - Breadcrumb navigation bar (back + category + name + actions)
 *   - Centered content area (max-w-4xl) with generous whitespace
 *   - Full-width CodeViewer with rounded borders
 *   - Collapsible version history
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  Pencil,
  Trash2,
  History,
  ChevronDown,
  Tag,
  FileCode,
  Terminal,
  Package,
  Store,
  LayoutTemplate,
  Clock,
  FileUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { CodeViewer } from '@/components/ui/code-viewer'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CATEGORY_MAP } from './categoryRegistry'
import { useCapabilitySnapshot } from '@/hooks/useCapabilitySnapshot'
import { usePackageUninstall } from '@/hooks/usePackageUninstall'
import { resolveCapability } from '@/lib/capabilityAdapter'
import type {
  CapabilityEntry,
  ManagedCapabilityIdentifier,
  CapabilityImportRecord,
  CapabilityMountInfo,
  BundleFileInfo,
  ManagedCapabilityCategory,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ── Types ────────────────────────────────────────────────────────────

interface InlineCapabilityDetailProps {
  identifier: ManagedCapabilityIdentifier
  onBack: () => void
  onEdit: (identifier: ManagedCapabilityIdentifier) => void
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

/** Map file extension to Monaco language id for CodeViewer. */
function detectLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    py: 'python', sh: 'shell', bash: 'shell', js: 'javascript',
    ts: 'typescript', json: 'json', md: 'markdown', yaml: 'yaml', yml: 'yaml',
    txt: 'plaintext', css: 'css', html: 'html', xml: 'xml', sql: 'sql',
    toml: 'toml', ini: 'ini', cfg: 'ini', rb: 'ruby', go: 'go', rs: 'rust',
  }
  return map[ext ?? ''] ?? 'plaintext'
}

/** Check whether a filePath is a skill bundle (ends with SKILL.md). */
function isBundlePath(filePath: string): boolean {
  return filePath.endsWith('/SKILL.md') || filePath.endsWith('\\SKILL.md')
}

// ── Bundle file selector ─────────────────────────────────────────────

function BundleFileSelector({ files, selected, onSelect }: {
  files: BundleFileInfo[]
  selected: string | null
  onSelect: (relativePath: string | null) => void
}): React.JSX.Element | null {
  const fileList = files.filter(f => !f.isDirectory)
  if (fileList.length === 0) return null

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <select
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className={cn(
          'text-[11px] bg-transparent rounded px-1.5 py-0.5 outline-none cursor-pointer',
          'border border-[hsl(var(--border)/0.4)]',
          'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
          'focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]',
        )}
      >
        <option value="">SKILL.md</option>
        {fileList.map(f => (
          <option key={f.relativePath} value={f.relativePath}>
            {f.relativePath}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Origin & Distribution sub-components ────────────────────────────

const ORIGIN_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'plugin': 'Plugin',
  'marketplace': 'Marketplace',
  'template': 'Template',
  'file': 'Local File',
  'unknown': 'Unknown',
}

const ORIGIN_ICONS: Record<string, typeof Terminal> = {
  'claude-code': Terminal,
  'plugin': Package,
  'marketplace': Store,
  'template': LayoutTemplate,
  'file': FileUp,
  'unknown': Package,
}

/** Origin info card — only shown for imported items */
function OriginCard({ importInfo }: { importInfo: CapabilityImportRecord }): React.JSX.Element {
  const Icon = ORIGIN_ICONS[importInfo.sourceOrigin] ?? Package
  const label = ORIGIN_LABELS[importInfo.sourceOrigin] ?? importInfo.sourceOrigin

  return (
    <div className="rounded-lg bg-[hsl(var(--muted)/0.2)] px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--foreground))]">
        <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
        <span>Imported from {label}</span>
      </div>
      <div className="text-[11px] text-[hsl(var(--muted-foreground))] space-y-0.5">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="h-3 w-3 shrink-0" />
          <span className="font-mono truncate">{importInfo.sourcePath}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span>{formatTimestamp(importInfo.importedAt)}</span>
        </div>
      </div>
    </div>
  )
}

/** Mount origin card — shown for externally-mounted items (read-only) */
function MountOriginCard({ mountInfo, onUninstall, uninstalling }: {
  mountInfo: CapabilityMountInfo
  onUninstall?: () => void
  uninstalling?: boolean
}): React.JSX.Element {
  const isPackageMount = mountInfo.sourceOrigin === 'marketplace'
  return (
    <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--foreground))]">
        <Package className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span>From: {mountInfo.namespace}</span>
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.6)]">
          Read-only
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
          v{mountInfo.version} · {isPackageMount ? 'Installed from Marketplace' : 'Managed by plugin'}
        </span>
        {isPackageMount && onUninstall && (
          <button
            type="button"
            onClick={onUninstall}
            disabled={uninstalling}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-md transition-colors',
              'text-red-500 hover:bg-red-500/10',
              uninstalling && 'opacity-50 cursor-not-allowed',
            )}
          >
            {uninstalling ? 'Uninstalling…' : 'Uninstall Package'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────

interface VersionRecord {
  id: number
  contentHash: string
  createdAt: number
}

export function InlineCapabilityDetail({
  identifier,
  onBack,
  onEdit,
}: InlineCapabilityDetailProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live entry from snapshot — auto-refreshes on change
  const { snapshot } = useCapabilitySnapshot(identifier.projectId)
  const liveEntry = snapshot
    ? resolveCapability(snapshot, identifier.category, identifier.name, identifier.scope)
    : undefined

  // External mount entries are read-only (managed externally, not individually editable)
  const isExternalMount = !!liveEntry?.mountInfo

  // Package uninstall — imperative hook (requestUninstall opens dialog + stores target)
  const pkgUninstall = usePackageUninstall(onBack)
  const isUninstallable = liveEntry?.mountInfo?.sourceOrigin === 'marketplace'

  const handleRequestUninstall = useCallback(() => {
    if (!liveEntry?.mountInfo || liveEntry.mountInfo.sourceOrigin !== 'marketplace') return
    pkgUninstall.requestUninstall({
      prefix: liveEntry.mountInfo.namespace,
      scope: identifier.scope,
      projectId: identifier.projectId,
    })
  }, [liveEntry?.mountInfo?.namespace, liveEntry?.mountInfo?.sourceOrigin, identifier.scope, identifier.projectId, pkgUninstall.requestUninstall])

  // Version history
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<VersionRecord[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)

  // Bundle file browsing — only for bundle-format skills (filePath ends with SKILL.md)
  const [bundleFiles, setBundleFiles] = useState<BundleFileInfo[]>([])
  const [selectedBundleFile, setSelectedBundleFile] = useState<string | null>(null)
  const [bundleFileContent, setBundleFileContent] = useState<string | null>(null)
  const [bundleFileLoading, setBundleFileLoading] = useState(false)
  const bundleFileLoadRequestId = useRef(0)

  const config = CATEGORY_MAP[identifier.category as ManagedCapabilityCategory]
  const Icon = config?.icon
  const categoryLabel = config
    ? t(`capabilityCenter.categories.${config.titleKey}`)
    : identifier.category
  const displayName =
    identifier.category === 'command' ? `/${identifier.name}` : identifier.name

  // ── Actions ────────────────────────────────────────────────────────

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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Toggle failed')
      }
    },
    [identifier],
  )

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
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeleting(false)
      setShowDeleteDialog(false)
    }
  }, [identifier, onBack])


  const loadVersions = useCallback(async () => {
    setVersionsLoading(true)
    try {
      const result = await getAppAPI()['capability:versions']({
        category: identifier.category,
        name: identifier.name,
        limit: 20,
      })
      setVersions(result)
    } catch {
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
    } catch {
      setError('Failed to load version')
    }
  }, [])

  // ── Bundle file listing — fetch on mount for bundle-format skills ──

  useEffect(() => {
    if (!liveEntry || liveEntry.kind !== 'document') {
      bundleFileLoadRequestId.current += 1
      setBundleFiles([])
      setSelectedBundleFile(null)
      setBundleFileContent(null)
      setBundleFileLoading(false)
      return
    }
    if (!isBundlePath(liveEntry.filePath)) {
      bundleFileLoadRequestId.current += 1
      setBundleFiles([])
      setSelectedBundleFile(null)
      setBundleFileContent(null)
      setBundleFileLoading(false)
      return
    }
    let cancelled = false
    getAppAPI()['capability:bundle-files'](liveEntry.filePath, identifier.projectId)
      .then((files) => { if (!cancelled) setBundleFiles(files) })
      .catch(() => { if (!cancelled) setBundleFiles([]) })
    return () => { cancelled = true }
  }, [liveEntry?.filePath, liveEntry?.kind, identifier.projectId])

  const handleBundleFileSelect = useCallback(async (relativePath: string | null) => {
    // null = back to SKILL.md
    if (!relativePath) {
      bundleFileLoadRequestId.current += 1
      setSelectedBundleFile(null)
      setBundleFileContent(null)
      setBundleFileLoading(false)
      return
    }
    const file = bundleFiles.find(f => f.relativePath === relativePath)
    if (!file || file.isDirectory) return

    setSelectedBundleFile(relativePath)
    setBundleFileContent(null)
    setBundleFileLoading(true)
    const requestId = ++bundleFileLoadRequestId.current
    try {
      if (!liveEntry || liveEntry.kind !== 'document' || !isBundlePath(liveEntry.filePath)) {
        if (requestId !== bundleFileLoadRequestId.current) return
        setBundleFileContent('// Bundle context unavailable')
        return
      }
      const result = await getAppAPI()['capability:view-bundle-file-content']({
        projectId: identifier.projectId,
        bundle: {
          skillFilePath: liveEntry.filePath,
          relativePath: file.relativePath,
        },
      })
      if (requestId !== bundleFileLoadRequestId.current) return
      if (!result.ok) {
        setBundleFileContent(`// ${result.error.message || 'Failed to load file content'}`)
        return
      }
      setBundleFileContent(result.data.content)
    } catch {
      if (requestId !== bundleFileLoadRequestId.current) return
      setBundleFileContent('// Failed to load file content')
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      if (requestId !== bundleFileLoadRequestId.current) return
      setBundleFileLoading(false)
    }
  }, [bundleFiles, identifier.projectId, liveEntry])

  // ── Loading state ──────────────────────────────────────────────────

  if (!liveEntry) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        Loading…
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ── Breadcrumb navigation bar ── */}
      <div className="flex items-center h-11 px-4 border-b border-[hsl(var(--border)/0.4)] shrink-0">
        {/* Left: back + breadcrumb */}
        <button
          type="button"
          onClick={onBack}
          className="p-1 -ml-1 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors shrink-0"
          aria-label="Back to list"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <nav className="flex items-center gap-1 ml-2 min-w-0 text-sm">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors shrink-0"
          >
            {Icon && <Icon className={cn('h-3.5 w-3.5', config?.textColor)} />}
            <span>{categoryLabel}</span>
          </button>
          <ChevronRight className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)] shrink-0" />
          <span className="font-medium text-[hsl(var(--foreground))] truncate">
            {displayName}
          </span>
        </nav>

        {/* Right: actions */}
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          <Switch
            checked={liveEntry.enabled}
            onChange={handleToggle}
            size="md"
            label={liveEntry.enabled ? 'Disable' : 'Enable'}
          />
          {!isExternalMount && (
            <>
              <div className="w-px h-4 bg-[hsl(var(--border)/0.4)]" />
              <button
                type="button"
                onClick={() => onEdit(identifier)}
                aria-label={`Edit ${identifier.name}`}
                className="p-1.5 rounded-md hover:bg-[hsl(var(--foreground)/0.04)] transition-colors"
              >
                <Pencil className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteDialog(true)}
                disabled={deleting}
                aria-label={`Delete ${identifier.name}`}
                className="p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500/70" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {(error || pkgUninstall.error) && (
        <div className="px-4 py-2 text-xs text-red-500 bg-red-500/5" role="alert">
          {error || pkgUninstall.error}
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="max-w-4xl mx-auto w-full flex-1 min-h-0 flex flex-col px-8">
          {/* Header: name + meta */}
          <div className="space-y-3 pt-6 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              {Icon && (
                <div className={cn('p-2 rounded-lg', config?.bgColor)}>
                  <Icon className={cn('h-5 w-5', config?.textColor)} />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-[hsl(var(--foreground))] truncate">
                  {displayName}
                </h1>
                {liveEntry.description && (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5 leading-relaxed">
                    {liveEntry.description}
                  </p>
                )}
              </div>
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full',
                  identifier.scope === 'project'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
                )}
              >
                {identifier.scope === 'project'
                    ? t('capabilityCenter.scopeProject', 'Project')
                    : t('capabilityCenter.scopeGlobal', 'Global')}
              </span>
              <div className="flex items-start gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                <FolderOpen className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="font-mono text-[11px] break-all">
                  {identifier.filePath}
                </span>
              </div>
              {liveEntry.tags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tag className="h-3 w-3 text-[hsl(var(--muted-foreground))]" />
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
            </div>

            {/* Origin info */}
            <div className="space-y-2 pt-1">
              {isExternalMount ? (
                <MountOriginCard
                  mountInfo={liveEntry.mountInfo!}
                  onUninstall={isUninstallable ? handleRequestUninstall : undefined}
                  uninstalling={pkgUninstall.uninstalling}
                />
              ) : (
                liveEntry.importInfo && <OriginCard importInfo={liveEntry.importInfo} />
              )}
            </div>
          </div>

          {/* Source section — fills remaining vertical space */}
          <div className="flex-1 min-h-0 flex flex-col gap-2 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] shrink-0">
              <FileCode className="h-3.5 w-3.5" />
              <span>Source</span>
              {bundleFiles.length > 0 && (
                <BundleFileSelector
                  files={bundleFiles}
                  selected={selectedBundleFile}
                  onSelect={handleBundleFileSelect}
                />
              )}
            </div>

            <div className="flex-1 min-h-0 rounded-xl border border-[hsl(var(--border)/0.5)] overflow-hidden flex flex-col">
              {selectedVersion !== null ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-[hsl(var(--muted)/0.3)] text-xs text-[hsl(var(--muted-foreground))] shrink-0">
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
              ) : selectedBundleFile && bundleFileLoading ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-[hsl(var(--muted)/0.3)] text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                    <span className="font-mono truncate">{selectedBundleFile}</span>
                    <button
                      type="button"
                      onClick={() => handleBundleFileSelect(null)}
                      className="text-[hsl(var(--primary))] hover:underline shrink-0 ml-2"
                    >
                      Back to SKILL.md
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                    Loading…
                  </div>
                </div>
              ) : selectedBundleFile && bundleFileContent !== null ? (
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between px-4 py-1.5 bg-[hsl(var(--muted)/0.3)] text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                    <span className="font-mono truncate">{selectedBundleFile}</span>
                    <button
                      type="button"
                      onClick={() => handleBundleFileSelect(null)}
                      className="text-[hsl(var(--primary))] hover:underline shrink-0 ml-2"
                    >
                      Back to SKILL.md
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    <CodeViewer content={bundleFileContent} language={detectLanguageFromPath(selectedBundleFile)} />
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0">
                  <CodeViewer
                    content={getSourceContent(liveEntry)}
                    language={getSourceLanguage(liveEntry)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Version history (collapsible) */}
          <div className="border-t border-[hsl(var(--border)/0.3)] py-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleVersions}
              className="flex items-center gap-1.5 py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              aria-expanded={versionsOpen}
            >
              {versionsOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <History className="h-3 w-3" />
              <span>Version History</span>
            </button>
            {versionsOpen && (
              <div className="pl-6 pb-2 max-h-48 overflow-y-auto">
                {versionsLoading ? (
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Loading…</p>
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
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        title={`Delete ${categoryLabel}`}
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
    </div>
  )
}
