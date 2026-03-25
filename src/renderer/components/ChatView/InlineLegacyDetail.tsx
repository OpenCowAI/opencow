// SPDX-License-Identifier: Apache-2.0

/**
 * InlineLegacyDetail — Full-width inline detail view for legacy (read-only) capabilities.
 *
 * Used for Plugin and LSP Server categories which are not managed by the Capability Center.
 * Shows rich metadata + source code viewer in a Linear-style in-page layout.
 * Read-only — no edit/delete/toggle actions.
 */

import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  FileCode,
  Package,
  Server,
  Globe,
  User2,
  Terminal,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CodeViewer } from '@/components/ui/code-viewer'
import { CATEGORY_MAP } from './categoryRegistry'
import { extractSourceSection } from '@shared/capabilityParsers'
import type {
  CapabilityIdentifier,
  CapabilitySourceResult,
  PluginEntry,
  LSPServerEntry,
  CapabilityEntryBase,
} from '@shared/types'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { getAppAPI } from '@/windowAPI'

// ── Types ────────────────────────────────────────────────────────────

interface InlineLegacyDetailProps {
  identifier: CapabilityIdentifier
  /** The full entry data for rendering rich metadata */
  entry?: CapabilityEntryBase
  onBack: () => void
}

// ── Metadata sections ────────────────────────────────────────────────

function MetaRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  mono?: boolean
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex items-center gap-2 w-28 shrink-0">
        <Icon className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground)/0.5)]" />
        <span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span>
      </div>
      <div className={cn('text-xs text-[hsl(var(--foreground))]', mono && 'font-mono')}>
        {value}
      </div>
    </div>
  )
}

function PluginMetadata({ plugin }: { plugin: PluginEntry }): React.JSX.Element {
  const { t } = useTranslation('sessions')
  const { t: tCommon } = useTranslation('common')

  const capParts = [
    plugin.capabilities.commands > 0 &&
      t('capabilityCards.cmdCount', { count: plugin.capabilities.commands }),
    plugin.capabilities.skills > 0 &&
      t('capabilityCards.skillCount', { count: plugin.capabilities.skills }),
    plugin.capabilities.agents > 0 &&
      t('capabilityCards.agentCount', { count: plugin.capabilities.agents }),
    plugin.capabilities.hooks > 0 &&
      t('capabilityCards.hookCount', { count: plugin.capabilities.hooks }),
  ].filter(Boolean) as string[]

  return (
    <div className="divide-y divide-[hsl(var(--border)/0.2)]">
      {plugin.version && (
        <MetaRow icon={Package} label="Version" value={`v${plugin.version}`} mono />
      )}
      {plugin.author && <MetaRow icon={User2} label="Author" value={plugin.author} />}
      {plugin.marketplace && (
        <MetaRow
          icon={Globe}
          label="Marketplace"
          value={
            <span className="flex items-center gap-1.5">
              {plugin.marketplace}
              <ExternalLink className="h-3 w-3 text-[hsl(var(--muted-foreground)/0.4)]" />
            </span>
          }
        />
      )}
      <MetaRow
        icon={Package}
        label="Status"
        value={
          <span
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-md',
              plugin.enabled
                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                : 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
            )}
          >
            {plugin.enabled ? tCommon('enabled') : tCommon('disabled')}
            {plugin.blocked && ' · Blocked'}
          </span>
        }
      />
      {plugin.installScope && (
        <MetaRow icon={FolderOpen} label="Install scope" value={plugin.installScope} />
      )}
      {capParts.length > 0 && (
        <MetaRow
          icon={Terminal}
          label="Capabilities"
          value={
            <div className="flex items-center gap-1.5 flex-wrap">
              {capParts.map((part) => (
                <span
                  key={part}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground))]"
                >
                  {part}
                </span>
              ))}
            </div>
          }
        />
      )}
    </div>
  )
}

function LSPServerMetadata({ server }: { server: LSPServerEntry }): React.JSX.Element {
  return (
    <div className="divide-y divide-[hsl(var(--border)/0.2)]">
      {server.command && (
        <MetaRow
          icon={Terminal}
          label="Command"
          value={`${server.command} ${server.args.join(' ')}`}
          mono
        />
      )}
      {server.languages.length > 0 && (
        <MetaRow
          icon={FileCode}
          label="Languages"
          value={
            <div className="flex items-center gap-1.5 flex-wrap">
              {server.languages.map((lang) => (
                <span
                  key={lang}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-500/8 text-teal-600 dark:text-teal-400"
                >
                  {lang}
                </span>
              ))}
            </div>
          }
        />
      )}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────

export function InlineLegacyDetail({
  identifier,
  entry,
  onBack,
}: InlineLegacyDetailProps): React.JSX.Element {
  const { t } = useTranslation('sessions')

  const projects = useAppStore((s) => s.projects)
  const selectedProjectId = useAppStore(selectProjectId)
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  // Source code loading
  const [source, setSource] = useState<CapabilitySourceResult | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)

  const loadSource = useCallback(async () => {
    setSourceLoading(true)
    setSourceError(null)
    try {
      const result = await getAppAPI()['read-capability-source'](
        identifier.source.sourcePath,
        selectedProject?.path,
      )
      setSource(result)
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : 'Failed to load source')
    } finally {
      setSourceLoading(false)
    }
  }, [identifier.source.sourcePath, selectedProject?.path])

  useEffect(() => {
    loadSource()
  }, [loadSource])

  const config = CATEGORY_MAP[identifier.category]
  const Icon = config?.icon
  const categoryLabel = config
    ? t(`capabilityCenter.categories.${config.titleKey}`)
    : identifier.category
  const displayName = identifier.name

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
      </div>

      {/* ── Main content (scrollable) ── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-4xl mx-auto px-8 pt-6 pb-8 space-y-6">
          {/* Header: icon + name + description */}
          <div className="space-y-3">
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
                {entry?.description && (
                  <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5 leading-relaxed">
                    {entry.description}
                  </p>
                )}
              </div>
            </div>

            {/* Meta row: scope + source path */}
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full',
                  identifier.source.scope === 'project'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
                )}
              >
                {identifier.source.scope}
              </span>
              <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                <FolderOpen className="h-3 w-3 shrink-0" />
                <span className="font-mono text-[11px] truncate max-w-sm">
                  {identifier.source.sourcePath}
                </span>
              </div>
            </div>
          </div>

          {/* Type-specific metadata */}
          {entry && identifier.category === 'plugin' && (
            <div className="rounded-xl border border-[hsl(var(--border)/0.4)] px-4">
              <PluginMetadata plugin={entry as PluginEntry} />
            </div>
          )}
          {entry && identifier.category === 'lsp-server' && (
            <div className="rounded-xl border border-[hsl(var(--border)/0.4)] px-4">
              <LSPServerMetadata server={entry as LSPServerEntry} />
            </div>
          )}

          {/* Source section */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
              <FileCode className="h-3.5 w-3.5" />
              <span>Source</span>
            </div>

            <div className="rounded-xl border border-[hsl(var(--border)/0.5)] overflow-hidden">
              {sourceLoading && (
                <div className="flex items-center justify-center h-48 text-sm text-[hsl(var(--muted-foreground))]">
                  Loading…
                </div>
              )}
              {sourceError && (
                <div className="flex items-center justify-center h-48 text-sm text-red-500" role="alert">
                  {sourceError}
                </div>
              )}
              {source && (
                <div className="h-[400px]">
                  <CodeViewer
                    content={extractSourceSection(identifier.category, source.content, identifier.name)}
                    language={source.language}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
