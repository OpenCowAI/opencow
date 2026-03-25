// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback } from 'react'
import {
  ArrowLeft,
  Download,
  ExternalLink,
  User,
  Star,
  FileText,
  Shield,
  Loader2,
  GitBranch,
  Check,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { usePackageUninstall } from '@/hooks/usePackageUninstall'
import type { MarketSkillDetail, InstalledPackageInfo } from '@shared/types'
import { getProviderTheme } from './providerTheme'

interface SkillDetailPanelProps {
  detail: MarketSkillDetail
  loading: boolean
  installing: boolean
  onBack: () => void
  onInstall: () => void
  /** If this skill's package is already installed, pass the record here */
  installedPackage?: InstalledPackageInfo | null
  /** Called after a successful uninstall */
  onUninstalled?: () => void
}

/**
 * Full-width inline detail panel for a marketplace skill.
 * Renders SKILL.md content with metadata sidebar and install CTA.
 */
export const SkillDetailPanel = memo(function SkillDetailPanel({
  detail,
  loading,
  installing,
  onBack,
  onInstall,
  installedPackage,
  onUninstalled,
}: SkillDetailPanelProps): React.JSX.Element {
  const theme = getProviderTheme(detail.marketplaceId)
  const isInstalled = !!installedPackage

  // Package uninstall — imperative hook (requestUninstall opens dialog + stores target)
  const pkgUninstall = usePackageUninstall(onUninstalled)

  const handleRequestUninstall = useCallback(() => {
    if (!installedPackage) return
    pkgUninstall.requestUninstall({
      prefix: installedPackage.prefix,
      scope: installedPackage.scope as 'global' | 'project',
      projectId: installedPackage.projectId || undefined,
    })
  }, [installedPackage?.prefix, installedPackage?.scope, installedPackage?.projectId, pkgUninstall.requestUninstall])

  const handleInstall = useCallback(() => {
    if (!installing) onInstall()
  }, [installing, onInstall])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      {/* pr-12 leaves room for the dialog's absolute-positioned close button */}
      <div className="flex items-center gap-3 pl-6 pr-12 py-3 border-b border-[hsl(var(--border)/0.4)]">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] rounded-md px-2 py-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold truncate">{detail.name}</h2>
            {/* Slug */}
            <span className="text-[11px] text-[hsl(var(--muted-foreground)/0.35)] truncate">
              /{detail.slug.split('/').pop()}
            </span>
          </div>
        </div>

        {/* Install / Installed actions */}
        {isInstalled ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" />
              Installed
            </span>
            <button
              type="button"
              onClick={handleRequestUninstall}
              disabled={pkgUninstall.uninstalling}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none',
                'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                'text-red-500 hover:bg-red-500/10',
                pkgUninstall.uninstalling && 'opacity-50 cursor-not-allowed',
              )}
            >
              {pkgUninstall.uninstalling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {pkgUninstall.uninstalling ? 'Uninstalling…' : 'Uninstall'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors outline-none',
              'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              installing
                ? 'bg-[hsl(var(--muted)/0.5)] text-[hsl(var(--muted-foreground)/0.5)] cursor-not-allowed'
                : 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90',
            )}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {installing ? 'Installing…' : 'Install'}
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Metadata strip */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Author */}
            {detail.author && (
              <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{detail.author.startsWith('@') ? detail.author : `@${detail.author}`}</span>
              </div>
            )}

            {/* Version */}
            {detail.version && (
              <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-md bg-[hsl(var(--muted)/0.4)] text-[hsl(var(--muted-foreground)/0.8)]">
                v{detail.version}
              </span>
            )}

            {/* Provider badge */}
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md', theme.badge)}>
              {theme.label}
            </span>

            {/* License */}
            {detail.license && (
              <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground)/0.6)]">
                <Shield className="h-3 w-3" aria-hidden="true" />
                <span>{detail.license}</span>
              </div>
            )}

            {/* Installs — always show with download icon */}
            {detail.installs != null && (
              <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground)/0.6)]">
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>{detail.installs.toLocaleString()} installs</span>
              </div>
            )}

            {/* Stars — independent from installs */}
            {detail.stars != null && detail.stars > 0 && (
              <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground)/0.6)]">
                <Star className="h-3 w-3" aria-hidden="true" />
                <span>{detail.stars.toLocaleString()}</span>
              </div>
            )}

            {/* Version count */}
            {detail.versionCount != null && detail.versionCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground)/0.6)]">
                <GitBranch className="h-3 w-3" aria-hidden="true" />
                <span>{detail.versionCount} version{detail.versionCount !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Repository link */}
            {detail.repoUrl && (
              <a
                href={detail.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Repository
              </a>
            )}
          </div>

          {/* Description */}
          {detail.description && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6 leading-relaxed">
              {detail.description}
            </p>
          )}

          {/* Tags */}
          {detail.tags && detail.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[hsl(var(--foreground)/0.04)] text-[hsl(var(--muted-foreground)/0.7)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Bundle files */}
          {detail.files && detail.files.length > 0 && (
            <div className="mb-6 p-3 rounded-xl border border-[hsl(var(--border)/0.3)] bg-[hsl(var(--foreground)/0.01)]">
              <h3 className="text-xs font-medium text-[hsl(var(--muted-foreground)/0.7)] mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Bundle Contents
              </h3>
              <div className="space-y-1">
                {detail.files.map((f) => (
                  <div
                    key={f.path}
                    className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground)/0.6)]"
                  >
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--muted)/0.3)] font-mono">
                      {f.type}
                    </span>
                    <span className="font-mono truncate">{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SKILL.md content — rendered with prose-container for documentation-grade typography */}
          {detail.content && (
            <>
              <hr className="border-t border-[hsl(var(--border)/0.2)] mb-6" />
              <div className="prose-container">
                <MarkdownContent content={detail.content} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Uninstall error banner */}
      {pkgUninstall.error && (
        <div className="px-6 py-2 text-xs text-red-500 bg-red-500/5 border-t border-red-500/10" role="alert">
          {pkgUninstall.error}
        </div>
      )}

      {/* Uninstall confirm dialog */}
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
})
